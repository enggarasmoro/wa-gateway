import { Client, LocalAuth, Message, WAState } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import {
  ConnectionState,
  MessageResponse,
  SendMessageOptions,
  WhatsAppLogoutResult,
  WhatsAppReconnectResult,
} from '../types';
import { formatPhoneNumber, PhoneNumberValidationError } from '../utils/phone.util';
import {
  createOperationContext,
  logOperationFinish,
  logOperationStart,
} from '../utils/logger.util';
import { readBooleanEnv, readIntegerEnv } from '../utils/env.util';
import {
  getErrorMessage,
  hasWhatsAppSendCapability,
  isTransientWhatsAppInjectionError,
  shouldRecoverFromReadinessError,
  shouldRecoverFromState,
  shouldReconnectAfterDisconnect,
} from './whatsapp-lifecycle.util';

// Message log entry
interface MessageLog {
  timestamp: Date;
  target: string;
  message: string;
  success: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'unconfirmed' | 'error';
  id?: string;
  error?: string;
}

export interface PendingMessageMatch {
  readonly chatId: string;
  readonly message: string;
}

export interface OutgoingMessageIdentity {
  readonly to?: string;
  readonly body?: string;
}

export type MessageAcknowledgementStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'error';

export function getMessageStatusFromAck(ack: number): MessageAcknowledgementStatus {
  if (ack < 0) return 'error';
  if (ack >= 3) return 'read';
  if (ack === 2) return 'delivered';
  if (ack === 1) return 'sent';
  return 'pending';
}

export function findPendingMessageMatch<T extends PendingMessageMatch>(
  pendingConfirmations: readonly T[],
  message: OutgoingMessageIdentity
): T | undefined {
  if (typeof message.body !== 'string') {
    return undefined;
  }

  const exactMatch = pendingConfirmations.find(
    (pending) => pending.chatId === message.to && pending.message === message.body
  );
  if (exactMatch) {
    return exactMatch;
  }

  const bodyMatches = pendingConfirmations.filter((pending) => pending.message === message.body);
  return bodyMatches.length === 1 ? bodyMatches[0] : undefined;
}

export function createPendingMessageResponse(target: string): MessageResponse {
  return {
    success: true,
    status: 'pending',
    message: 'Message accepted and awaiting confirmation.',
    target,
  };
}

interface PendingConfirmation {
  chatId: string;
  message: string;
  log: MessageLog;
  correlationId: string;
  timer: NodeJS.Timeout;
  confirmed: boolean;
}

/**
 * Returns a WhatsApp message ID only when the upstream send result confirms one.
 */
export function getConfirmedMessageId(result: unknown): string | undefined {
  if (result === null || typeof result !== 'object' || !('id' in result)) {
    return undefined;
  }

  const message = result.id;
  if (message === null || typeof message !== 'object' || !('id' in message)) {
    return undefined;
  }

  const messageId = message.id;
  return typeof messageId === 'string' && messageId.length > 0 ? messageId : undefined;
}

/**
 * WhatsApp Service using whatsapp-web.js
 * Following best practices from https://docs.wwebjs.dev/
 */
class WhatsAppService {
  private client!: Client;
  private connectionState: ConnectionState = {
    isConnected: false,
    startTime: new Date(),
    qrDisplayed: false,
  };
  private messageDelay: number;
  private isReady: boolean = false;
  private waState: string = 'IDLE';
  private qrCodeBase64: string | null = null;
  private messageLogs: MessageLog[] = [];
  private pendingConfirmations = new Map<string, PendingConfirmation[]>();
  private readonly MAX_LOGS = 100;
  private readonly PENDING_CONFIRMATION_TIMEOUT_MS = 60000;
  private lastReadinessLogAt: number = 0;
  private clientGeneration: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isInitializing: boolean = false;
  private isLoggingOut: boolean = false;
  private isShuttingDown: boolean = false;
  private runtimeRecoveryInProgress: boolean = false;

  // Anti-ban features
  private dailyMessageCount: number = 0;
  private lastResetDate: string = new Date().toDateString();
  private readonly DAILY_MESSAGE_LIMIT = readIntegerEnv('DAILY_MESSAGE_LIMIT', 500, { min: 1, max: 100000 });
  private readonly TYPING_DELAY_MIN = 1000; // 1 second
  private readonly TYPING_DELAY_MAX = 3000; // 3 seconds
  private readonly INITIALIZE_RETRIES = readIntegerEnv('WHATSAPP_INITIALIZE_RETRIES', 2, { min: 0, max: 20 });
  private readonly INITIALIZE_RETRY_DELAY_MS = readIntegerEnv('WHATSAPP_INITIALIZE_RETRY_DELAY_MS', 5000, { min: 0, max: 300000 });
  private readonly AUTH_TIMEOUT_MS = readIntegerEnv('WHATSAPP_AUTH_TIMEOUT_MS', 120000, { min: 1000, max: 600000 });
  private readonly PUPPETEER_PROTOCOL_TIMEOUT_MS = readIntegerEnv('PUPPETEER_PROTOCOL_TIMEOUT_MS', 300000, { min: 1000, max: 600000 });
  private readonly CHROME_NO_SANDBOX = readBooleanEnv('CHROME_NO_SANDBOX', false);
  private readonly LOG_MESSAGE_CONTENT = readBooleanEnv('LOG_MESSAGE_CONTENT', false);

  constructor() {
    this.messageDelay = readIntegerEnv('MESSAGE_DELAY_MS', 1000, { min: 0, max: 600000 });
    this.createClient();
  }

  /**
   * Create WhatsApp client instance
   */
  private createClient(): void {
    const authFolder = process.env.AUTH_FOLDER || './auth';
    const generation = ++this.clientGeneration;

    // Initialize client with LocalAuth for session persistence
    // Ref: https://docs.wwebjs.dev/LocalAuth.html
    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: authFolder,
        clientId: 'wa-gateway',
      }),
      authTimeoutMs: this.AUTH_TIMEOUT_MS,
      // Anti-auto-read: keep the account presence "unavailable" so incoming
      // messages do NOT get marked as read just because the client is online.
      markOnlineAvailable: false,
      puppeteer: {
        headless: true,
        protocolTimeout: this.PUPPETEER_PROTOCOL_TIMEOUT_MS,
        // Anti-detection: pin a realistic desktop Chrome UA. Default headless UA
        // is trivially fingerprinted by WhatsApp's anti-bot heuristics.
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        args: [
          ...(this.CHROME_NO_SANDBOX ? ['--no-sandbox', '--disable-setuid-sandbox', '--no-zygote'] : []),
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-software-rasterizer',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
        ],
        timeout: 120000,
      },
    } as ConstructorParameters<typeof Client>[0]);

    this.client = client;
    this.setupEventHandlers(client, generation);
  }

  /**
   * Setup all event handlers
   * Ref: https://docs.wwebjs.dev/global.html#Events
   */
  private setupEventHandlers(client: Client, generation: number): void {
    // QR Code received - User needs to scan
    client.on('qr', async (qr: string) => {
      if (!this.isActiveClient(generation)) return;

      this.clearReconnectTimer();
      this.runtimeRecoveryInProgress = false;
      this.connectionState.isConnected = false;
      this.isReady = false;

      console.log('\n');
      console.log('═'.repeat(50));
      console.log('📱 SCAN QR CODE WITH WHATSAPP');
      console.log('═'.repeat(50));
      qrcode.generate(qr, { small: true });
      console.log('═'.repeat(50));
      console.log('\n');
      
      // Generate base64 QR code for dashboard
      try {
        this.qrCodeBase64 = await QRCode.toDataURL(qr, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (err) {
        console.error('Failed to generate QR base64:', err);
      }
      
      this.connectionState.qrDisplayed = true;
      this.waState = 'WAITING_FOR_QR_SCAN';
    });

    // Loading screen progress
    client.on('loading_screen', (percent: number, message: string) => {
      if (!this.isActiveClient(generation)) return;

      console.log(`⏳ Loading: ${percent}% - ${message}`);
    });

    // Authentication successful (after QR scan)
    client.on('authenticated', () => {
      if (!this.isActiveClient(generation)) return;

      console.log('🔐 Authentication successful!');
      this.waState = 'AUTHENTICATED';
    });

    // Client is ready to send/receive messages
    client.on('ready', () => {
      if (!this.isActiveClient(generation)) return;

      this.markClientReady('ready event');
    });

    // Authentication failure
    client.on('auth_failure', (msg: string) => {
      if (!this.isActiveClient(generation)) return;

      console.error('❌ Authentication failed:', msg);
      console.error('💡 Try deleting the auth folder and restarting');
      this.connectionState.isConnected = false;
      this.isReady = false;
      this.waState = 'AUTH_FAILURE';
    });

    // State changed (CONFLICT, CONNECTED, DEPRECATED, OPENING, PAIRING, PROXYBLOCK,
    // SMB_TOS_BLOCK, TIMEOUT, TOS_BLOCK, UNLAUNCHED, UNPAIRED, UNPAIRED_IDLE)
    client.on('change_state', (state: WAState) => {
      if (!this.isActiveClient(generation)) return;

      console.log(`📊 State changed: ${state}`);
      this.waState = state;

      if (state !== 'CONNECTED') {
        this.connectionState.isConnected = false;
        this.isReady = false;
      }
    });

    // Disconnected from WhatsApp
    client.on('disconnected', (reason: string) => {
      if (!this.isActiveClient(generation)) return;

      console.log('📴 Disconnected:', reason);
      this.connectionState.isConnected = false;
      this.isReady = false;
      this.waState = 'DISCONNECTED';

      if (!shouldReconnectAfterDisconnect(reason, this.isLoggingOut, this.isShuttingDown)) {
        console.log('ℹ️ Reconnect skipped for intentional disconnect');
        return;
      }

      this.scheduleReconnect(generation);
    });

    // Message received (for logging/debugging)
    client.on('message', (msg: Message) => {
      if (!this.isActiveClient(generation)) return;

      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`📩 Message received from ${this.maskTarget(msg.from)}`);
      }
    });

    // Message sent by us
    client.on('message_create', (msg: Message) => {
      if (!this.isActiveClient(generation)) return;

      if (msg.fromMe) {
        this.capturePendingMessageId(msg);
      }

      if (msg.fromMe && process.env.LOG_LEVEL === 'debug') {
        console.log(`📤 Message sent to ${this.maskTarget(msg.to)}`);
      }
    });

    // Message acknowledgement (delivered, read, etc)
    client.on('message_ack', (msg: Message, ack: number) => {
      if (!this.isActiveClient(generation)) return;

      if (msg.fromMe) {
        this.handlePendingMessageAck(msg, ack);
      }

      if (process.env.LOG_LEVEL === 'debug') {
        const ackStatus = ['ERROR', 'PENDING', 'SERVER', 'DEVICE', 'READ', 'PLAYED'];
        console.log(`✓ Message ${getConfirmedMessageId(msg) ?? 'unknown'}: ${ackStatus[ack] || ack}`);
      }
    });
  }

  /**
   * Initialize WhatsApp connection
   */
  async initialize(): Promise<void> {
    // Prevent double initialization
    if (this.isInitializing || this.isReady || this.isShuttingDown) {
      console.log('⚠️ Already initializing or connected, skipping...');
      return;
    }

    this.clearReconnectTimer();
    this.isInitializing = true;
    this.waState = 'INITIALIZING';

    try {
      for (let attempt = 1; attempt <= this.INITIALIZE_RETRIES + 1; attempt++) {
        const generation = this.clientGeneration;

        await this.removeStaleAuthLock();

        try {
          await this.client.initialize();
          return;
        } catch (error) {
          const message = getErrorMessage(error);

          if (this.isReady && isTransientWhatsAppInjectionError(error)) {
            console.warn(`⚠️ WhatsApp initialization reported a transient injection error after ready: ${message}`);
            this.connectionState.lastError = message;
            return;
          }

          if (!this.isActiveClient(generation)) {
            console.warn('⚠️ Ignoring initialization failure from a stale WhatsApp client');
            return;
          }

          this.connectionState.lastError = message;

          if (attempt <= this.INITIALIZE_RETRIES && isTransientWhatsAppInjectionError(error)) {
            console.warn(
              `⚠️ WhatsApp initialization attempt ${attempt} failed with a transient Puppeteer error: ${message}`
            );
            await this.replaceFailedClient(`initialize retry ${attempt}`);
            await this.delay(this.INITIALIZE_RETRY_DELAY_MS);
            continue;
          }

          this.waState = 'ERROR';
          console.error('❌ Failed to initialize:', error);
          await this.replaceFailedClient('terminal initialize failure');
          this.waState = 'ERROR';
          if (!this.isLoggingOut && !this.isShuttingDown) {
            this.scheduleReconnect(this.clientGeneration);
          }
          throw error;
        }
      }
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Queues a message send without waiting for WhatsApp Web to return.
   * The accepted response preserves the existing pending MessageResponse contract.
   */
  queueMessage(
    target: string,
    message: string,
    options: SendMessageOptions = {}
  ): MessageResponse {
    const correlationId = options.correlationId || randomUUID();
    const context = createOperationContext('whatsapp.queue_message', correlationId);
    const targetRef = this.maskTarget(target);

    logOperationStart(context, {
      target: targetRef,
      userId: options.userId,
    });

    try {
      const formattedNumber = formatPhoneNumber(target);
      const queuedResponse = createPendingMessageResponse(formattedNumber);

      void this.sendMessage(formattedNumber, message, {
        ...options,
        correlationId,
      }).then((result) => {
        logOperationFinish(context, result.success ? 'success' : 'failure', {
          target: this.maskTarget(formattedNumber),
          userId: options.userId,
          status: result.status,
        });
      }).catch((error) => {
        logOperationFinish(context, 'failure', {
          target: this.maskTarget(formattedNumber),
          userId: options.userId,
          status: 'error',
          error: getErrorMessage(error),
        });
      });

      return queuedResponse;
    } catch (error) {
      const messageText = error instanceof PhoneNumberValidationError
        ? error.message
        : 'Invalid phone number';

      logOperationFinish(context, 'failure', {
        target: targetRef,
        userId: options.userId,
        status: 'invalid_number',
        error: messageText,
      });

      return {
        success: false,
        status: 'invalid_number',
        message: messageText,
        target,
      };
    }
  }

  /**
   * Send a single message
   */
  async sendMessage(
    target: string,
    message: string,
    options: SendMessageOptions = {}
  ): Promise<MessageResponse> {
    const correlationId = options.correlationId || randomUUID();
    const context = createOperationContext('whatsapp.send_message', correlationId);
    const targetRef = this.maskTarget(target);
    let formattedNumber: string;

    logOperationStart(context, {
      target: targetRef,
      userId: options.userId,
    });

    try {
      formattedNumber = formatPhoneNumber(target);
    } catch (error) {
      const messageText = error instanceof PhoneNumberValidationError
        ? error.message
        : 'Invalid phone number';

      this.addMessageLog({
        timestamp: new Date(),
        target: this.maskTarget(target),
        message: this.getLoggedMessagePreview(message),
        success: false,
        status: 'error',
        error: messageText,
      });

      logOperationFinish(context, 'failure', {
        target: targetRef,
        userId: options.userId,
        status: 'invalid_number',
        error: messageText,
      });

      return {
        success: false,
        status: 'invalid_number',
        message: messageText,
        target,
      };
    }

    const isReady = await this.refreshConnectionReadiness('sendMessage');

    if (!isReady) {
      logOperationFinish(context, 'failure', {
        target: this.maskTarget(formattedNumber),
        userId: options.userId,
        status: 'disconnected',
        state: this.waState,
      });

      return {
        success: false,
        status: 'disconnected',
        message: this.getNotReadyMessage(),
      };
    }

    let pendingConfirmation: PendingConfirmation | undefined;

    try {
      // whatsapp-web.js format: number@c.us
      const chatId = `${formattedNumber}@c.us`;

      // Reset daily counter if new day
      const today = new Date().toDateString();
      if (this.lastResetDate !== today) {
        this.dailyMessageCount = 0;
        this.lastResetDate = today;
        console.log('📅 Daily message counter reset');
      }

      // Check daily limit
      if (this.dailyMessageCount >= this.DAILY_MESSAGE_LIMIT) {
        console.log(`⚠️ Daily message limit reached (${this.DAILY_MESSAGE_LIMIT})`);
        logOperationFinish(context, 'failure', {
          target: this.maskTarget(formattedNumber),
          userId: options.userId,
          status: 'rate_limited',
          dailyMessageLimit: this.DAILY_MESSAGE_LIMIT,
        });

        return {
          success: false,
          status: 'rate_limited',
          message: `Daily message limit reached (${this.DAILY_MESSAGE_LIMIT}). Try again tomorrow.`,
          target: formattedNumber,
        };
      }

      console.log(`📤 Sending message to: ${this.maskTarget(formattedNumber)}`);

      // Anti-ban: random pre-send delay only. Typing simulation was removed
      // because chat.sendStateTyping() forces the account into "online +
      // composing" presence on the target chat, which causes WhatsApp Web to
      // mark unread incoming messages from that contact as read (blue ticks).
      const preSendDelay = this.randomDelay(this.TYPING_DELAY_MIN, this.TYPING_DELAY_MAX);
      await this.delay(preSendDelay);

      if (!(await this.hasLiveSendCapability())) {
        const errorMessage = this.connectionState.lastError
          ?? 'WhatsApp runtime send capability is unavailable';

        this.addMessageLog({
          timestamp: new Date(),
          target: this.maskTarget(formattedNumber),
          message: this.getLoggedMessagePreview(message),
          success: false,
          status: 'error',
          error: errorMessage,
        });

        logOperationFinish(context, 'failure', {
          target: this.maskTarget(formattedNumber),
          userId: options.userId,
          status: 'disconnected',
          error: errorMessage,
        });

        return {
          success: false,
          status: 'disconnected',
          message: 'WhatsApp runtime became unavailable while sending. Reconnect has been scheduled; try again after the gateway is ready.',
          target: formattedNumber,
        };
      }

      pendingConfirmation = this.registerPendingConfirmation(
        chatId,
        formattedNumber,
        message,
        correlationId
      );

      // Send message with sendSeen: false to avoid markedUnread error
      const result = await this.client.sendMessage(chatId, message, {
        sendSeen: false,
      });

      const messageId = getConfirmedMessageId(result);
      this.capturePendingMessageId({
        to: chatId,
        body: message,
        id: messageId ? { id: messageId } : undefined,
      });

      if (pendingConfirmation.confirmed) {
        const confirmedMessageId = pendingConfirmation.log.id;

        logOperationFinish(context, 'success', {
          target: this.maskTarget(formattedNumber),
          userId: options.userId,
          status: 'sent',
          messageId: confirmedMessageId,
        });

        return {
          success: true,
          status: 'sent',
          message: 'Message sent successfully',
          target: formattedNumber,
          id: confirmedMessageId,
        };
      }

      logOperationFinish(context, 'success', {
        target: this.maskTarget(formattedNumber),
        userId: options.userId,
        status: 'pending',
      });

      return createPendingMessageResponse(formattedNumber);
    } catch (error) {
      if (pendingConfirmation?.confirmed) {
        logOperationFinish(context, 'success', {
          target: this.maskTarget(formattedNumber),
          userId: options.userId,
          status: 'sent',
          messageId: pendingConfirmation.log.id,
        });

        return {
          success: true,
          status: 'sent',
          message: 'Message sent successfully',
          target: formattedNumber,
          id: pendingConfirmation.log.id,
        };
      }

      console.error(`❌ Error sending message:`, error);

      const isRecoverableRuntimeError = this.handleRuntimeError(error, 'sendMessage');
      const errorMessage = getErrorMessage(error);

      if (pendingConfirmation) {
        this.failPendingConfirmation(pendingConfirmation, errorMessage);
      } else {
        this.addMessageLog({
          timestamp: new Date(),
          target: this.maskTarget(formattedNumber),
          message: this.getLoggedMessagePreview(message),
          success: false,
          status: 'error',
          error: errorMessage,
        });
      }

      logOperationFinish(context, 'failure', {
        target: this.maskTarget(formattedNumber),
        userId: options.userId,
        status: isRecoverableRuntimeError ? 'disconnected' : 'error',
        error: errorMessage,
      });

      return {
        success: false,
        status: isRecoverableRuntimeError ? 'disconnected' : 'error',
        message: isRecoverableRuntimeError
          ? 'WhatsApp runtime became unavailable while sending. Reconnect has been scheduled; try again after the gateway is ready.'
          : 'Failed to send message. Check gateway logs for details.',
        target: formattedNumber,
      };
    }
  }

  /**
   * Send broadcast messages to multiple targets
   */
  async sendBroadcast(
    targets: string[],
    message: string,
    options: SendMessageOptions = {}
  ): Promise<MessageResponse[]> {
    const correlationId = options.correlationId || randomUUID();
    const context = createOperationContext('whatsapp.send_broadcast', correlationId);
    const results: MessageResponse[] = [];

    logOperationStart(context, {
      targetCount: targets.length,
      userId: options.userId,
    });

    try {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const result = await this.sendMessage(target, message, {
          ...options,
          correlationId,
        });
        results.push(result);

        // Add delay between messages to avoid spam detection
        if (i < targets.length - 1) {
          await this.delay(this.messageDelay);
        }
      }

      const sentCount = results.filter((result) => result.success).length;
      logOperationFinish(context, sentCount === results.length ? 'success' : 'failure', {
        targetCount: targets.length,
        sentCount,
        userId: options.userId,
      });

      return results;
    } catch (error) {
      logOperationFinish(context, 'failure', {
        targetCount: targets.length,
        sentCount: results.filter((result) => result.success).length,
        userId: options.userId,
        error: error instanceof Error ? error.message : 'Unknown broadcast error',
      });

      throw error;
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return {
      ...this.connectionState,
      isReady: this.isReady,
      isRecovering: this.runtimeRecoveryInProgress || this.waState === 'RECOVERING_RUNTIME',
      reconnectScheduled: !!this.reconnectTimer,
    };
  }

  /**
   * Refresh current connection state from the live WhatsApp Web client.
   */
  async refreshConnectionState(operation = 'status'): Promise<ConnectionState> {
    await this.refreshConnectionReadiness(operation);
    return this.getConnectionState();
  }

  /**
   * Get WhatsApp state
   */
  getWAState(): string {
    return this.waState;
  }

  /**
   * Check if connected and ready
   */
  isConnected(): boolean {
    return this.isReady && this.connectionState.isConnected;
  }

  /**
   * Mark the client as ready from either the official ready event or a live
   * getState() check that confirms WhatsApp Web is CONNECTED.
   */
  private markClientReady(source: string): void {
    if (!this.isReady) {
      console.log(`✅ WhatsApp client is ready (${source})!`);
    }

    this.connectionState.isConnected = true;
    this.connectionState.qrDisplayed = false;
    this.connectionState.lastError = undefined;
    this.isReady = true;
    this.waState = 'CONNECTED';
    this.qrCodeBase64 = null;

    // Anti-auto-read: force presence "unavailable" so incoming messages do not
    // get marked as seen (blue ticks) while the gateway is online.
    void this.client
      .sendPresenceUnavailable()
      .catch((err) => console.warn('⚠️ Failed to set presence unavailable:', (err as Error).message));

    const info = this.client.info;
    if (info) {
      this.connectionState.phoneNumber = info.wid.user;
      if (source === 'ready event') {
        console.log(`📱 Connected as: +${this.connectionState.phoneNumber}`);
        console.log(`📛 Name: ${info.pushname || 'Unknown'}`);
      }
    }
  }

  /**
   * Avoid rejecting sends because a local ready flag missed an event.
   */
  private async refreshConnectionReadiness(operation: string): Promise<boolean> {
    const hasCachedReady = this.isReady && this.connectionState.isConnected;

    if (hasCachedReady && !this.shouldVerifyLiveReadiness(operation)) {
      return true;
    }

    if (
      this.isInitializing ||
      this.reconnectTimer ||
      ['ERROR', 'RETRYING_INITIALIZE', 'RECOVERING_RUNTIME', 'IDLE'].includes(this.waState)
    ) {
      return false;
    }

    try {
      const state = await this.client.getState();

      if (state) {
        this.waState = state;
      }

      if (state === 'CONNECTED') {
        this.markClientReady(`live state check during ${operation}`);
        return true;
      }

      this.connectionState.isConnected = false;
      this.isReady = false;

      if (!state) {
        if (hasCachedReady) {
          const message = `WhatsApp state unavailable during ${operation}`;
          this.connectionState.lastError = message;
          this.startRuntimeRecovery(message);
        } else if (
          !this.connectionState.qrDisplayed &&
          !['WAITING_FOR_QR_SCAN', 'AUTHENTICATED', 'INITIALIZING'].includes(this.waState)
        ) {
          this.connectionState.lastError = `WhatsApp is not ready during ${operation}; state is unavailable`;
        }
      } else if (shouldRecoverFromState(state)) {
        const message = `WhatsApp state is ${state} during ${operation}`;
        this.connectionState.lastError = message;
        this.startRuntimeRecovery(message);
      } else {
        this.connectionState.lastError = `WhatsApp is not ready during ${operation}; current state is ${state}`;
      }

      return false;
    } catch (error) {
      const err = error as Error;
      this.connectionState.lastError = err.message;
      this.connectionState.isConnected = false;
      this.isReady = false;

      if (
        shouldRecoverFromReadinessError(
          error,
          this.waState,
          this.connectionState.qrDisplayed,
          hasCachedReady
        )
      ) {
        this.handleRuntimeError(error, `readiness check during ${operation}`);
      }

      const now = Date.now();
      if (now - this.lastReadinessLogAt > 30000) {
        console.warn(`⚠️ Unable to refresh WhatsApp readiness during ${operation}: ${err.message}`);
        this.lastReadinessLogAt = now;
      }

      return false;
    }
  }

  private shouldVerifyLiveReadiness(operation: string): boolean {
    return [
      'sendMessage',
      'status',
      'health',
    ].some((needle) => operation.includes(needle));
  }

  private getNotReadyMessage(): string {
    if (this.waState === 'AUTHENTICATED') {
      return 'WhatsApp is authenticated but not ready yet. Wait for the ready state, then try again.';
    }

    if (this.waState === 'CONNECTED') {
      return 'WhatsApp reports CONNECTED but the client is not ready to send yet. Try again in a few seconds.';
    }

    if (this.connectionState.qrDisplayed || this.waState === 'WAITING_FOR_QR_SCAN') {
      return 'WhatsApp is not connected. Please scan QR code.';
    }

    return `WhatsApp is not ready to send messages. Current state: ${this.waState}.`;
  }

  private async hasLiveSendCapability(): Promise<boolean> {
    const page = this.client.pupPage;

    if (!page) {
      const message = 'WhatsApp browser page is unavailable before sendMessage';
      this.connectionState.lastError = message;
      this.startRuntimeRecovery(message);
      return false;
    }

    try {
      if (await page.evaluate(hasWhatsAppSendCapability)) {
        return true;
      }

      const message = 'WhatsApp runtime send capability is unavailable before sendMessage';
      this.connectionState.lastError = message;
      this.startRuntimeRecovery(message);
      return false;
    } catch (error) {
      const message = getErrorMessage(error);
      this.connectionState.lastError = message;
      this.startRuntimeRecovery('runtime capability probe failure');
      return false;
    }
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor(
      (Date.now() - this.connectionState.startTime.getTime()) / 1000
    );
  }

  /**
   * Get client info
   */
  getInfo(): { phoneNumber?: string; name?: string } | null {
    if (!this.client.info) return null;
    return {
      phoneNumber: this.client.info.wid.user,
      name: this.client.info.pushname,
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Random delay helper for anti-ban
   */
  private randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private maskTarget(target: string): string {
    const digits = target.replace(/[^0-9]/g, '');
    if (digits.length <= 4) {
      return '****';
    }

    return `****${digits.slice(-4)}`;
  }

  private getLoggedMessagePreview(message: string): string {
    return this.LOG_MESSAGE_CONTENT ? message.substring(0, 100) : '[redacted]';
  }

  private registerPendingConfirmation(
    chatId: string,
    formattedNumber: string,
    message: string,
    correlationId: string
  ): PendingConfirmation {
    const log: MessageLog = {
      timestamp: new Date(),
      target: this.maskTarget(formattedNumber),
      message: this.getLoggedMessagePreview(message),
      success: false,
      status: 'pending',
    };
    let pendingConfirmation: PendingConfirmation;
    const timer = setTimeout(() => this.timeoutPendingConfirmation(pendingConfirmation), this.PENDING_CONFIRMATION_TIMEOUT_MS);
    pendingConfirmation = {
      chatId,
      message,
      log,
      correlationId,
      confirmed: false,
      timer,
    };

    pendingConfirmation.timer.unref();
    this.addMessageLog(log);
    const queue = this.pendingConfirmations.get(chatId) ?? [];
    queue.push(pendingConfirmation);
    this.pendingConfirmations.set(chatId, queue);

    return pendingConfirmation;
  }

  private findPendingConfirmation(message: OutgoingMessageIdentity): PendingConfirmation | undefined {
    return findPendingMessageMatch(
      [...this.pendingConfirmations.values()].flat(),
      message
    );
  }

  private capturePendingMessageId(message: OutgoingMessageIdentity & { id?: unknown }): void {
    const pendingConfirmation = this.findPendingConfirmation(message);
    const messageId = getConfirmedMessageId(message);
    if (pendingConfirmation && messageId) {
      pendingConfirmation.log.id = messageId;
    }
  }

  private handlePendingMessageAck(message: Message, ack: number): void {
    const pendingConfirmation = this.findPendingConfirmation(message);
    const messageId = getConfirmedMessageId(message);
    const status = getMessageStatusFromAck(ack);

    if (!pendingConfirmation) {
      this.updateConfirmedMessageLog(messageId, status);
      return;
    }

    if (messageId) {
      pendingConfirmation.log.id = messageId;
    }

    if (status === 'error') {
      this.failPendingConfirmation(pendingConfirmation, 'WhatsApp rejected the message.');
      return;
    }

    if (status !== 'pending') {
      this.confirmPendingConfirmation(pendingConfirmation, messageId, status);
    }
  }

  private confirmPendingConfirmation(
    pendingConfirmation: PendingConfirmation,
    messageId?: string,
    status: Extract<MessageLog['status'], 'sent' | 'delivered' | 'read'> = 'sent'
  ): void {
    if (pendingConfirmation.confirmed) {
      if (!pendingConfirmation.log.id && messageId) {
        pendingConfirmation.log.id = messageId;
      }
      if (status === 'delivered' || status === 'read') {
        pendingConfirmation.log.status = status;
      }
      return;
    }

    pendingConfirmation.confirmed = true;
    this.removePendingConfirmation(pendingConfirmation);
    pendingConfirmation.log.success = true;
    pendingConfirmation.log.status = status;
    pendingConfirmation.log.error = undefined;
    if (messageId) {
      pendingConfirmation.log.id = messageId;
    }
    this.dailyMessageCount++;
    console.log(`✅ Message sent to ${pendingConfirmation.log.target} [${this.dailyMessageCount}/${this.DAILY_MESSAGE_LIMIT}]`);
  }

  private failPendingConfirmation(pendingConfirmation: PendingConfirmation, error: string): void {
    this.removePendingConfirmation(pendingConfirmation);
    pendingConfirmation.log.success = false;
    pendingConfirmation.log.status = 'error';
    pendingConfirmation.log.error = error;
  }

  private timeoutPendingConfirmation(pendingConfirmation: PendingConfirmation): void {
    if (pendingConfirmation.confirmed) {
      return;
    }

    void this.reconcilePendingConfirmation(pendingConfirmation);
  }

  private async reconcilePendingConfirmation(pendingConfirmation: PendingConfirmation): Promise<void> {
    if (!this.isPendingConfirmationActive(pendingConfirmation)) {
      return;
    }

    const context = createOperationContext(
      'whatsapp.reconcile_message_confirmation',
      pendingConfirmation.correlationId
    );
    logOperationStart(context, { target: pendingConfirmation.log.target });
    let reconciliationFailed = false;

    try {
      const chat = await this.client.getChatById(pendingConfirmation.chatId);
      const recentMessages = await chat.fetchMessages({ limit: 10, fromMe: true });
      const matchingMessage = recentMessages.find(
        (message) => message.fromMe && message.body === pendingConfirmation.message
      );

      if (matchingMessage) {
        this.handlePendingMessageAck(matchingMessage, matchingMessage.ack);
      }
    } catch (error) {
      reconciliationFailed = true;
      logOperationFinish(context, 'failure', {
        target: pendingConfirmation.log.target,
        error: getErrorMessage(error),
      });
    }

    if (!this.isPendingConfirmationActive(pendingConfirmation) || pendingConfirmation.confirmed) {
      if (!reconciliationFailed) {
        logOperationFinish(context, 'success', {
          target: pendingConfirmation.log.target,
          status: pendingConfirmation.log.status,
        });
      }
      return;
    }

    this.removePendingConfirmation(pendingConfirmation);
    pendingConfirmation.log.success = false;
    pendingConfirmation.log.status = 'unconfirmed';
    pendingConfirmation.log.error = 'No WhatsApp server acknowledgement was received within 60 seconds. The message may still have been delivered.';
    if (!reconciliationFailed) {
      logOperationFinish(context, 'success', {
        target: pendingConfirmation.log.target,
        status: pendingConfirmation.log.status,
      });
    }
  }

  private updateConfirmedMessageLog(messageId: string | undefined, status: MessageAcknowledgementStatus): void {
    if (!messageId || status === 'pending') {
      return;
    }

    const messageLog = this.messageLogs.find((log) => log.id === messageId);
    if (!messageLog) {
      return;
    }

    messageLog.status = status;
    messageLog.success = status !== 'error';
    messageLog.error = status === 'error' ? 'WhatsApp rejected the message.' : undefined;
  }

  private isPendingConfirmationActive(pendingConfirmation: PendingConfirmation): boolean {
    return this.pendingConfirmations
      .get(pendingConfirmation.chatId)
      ?.includes(pendingConfirmation) ?? false;
  }

  private removePendingConfirmation(pendingConfirmation: PendingConfirmation): void {
    clearTimeout(pendingConfirmation.timer);
    const queue = this.pendingConfirmations.get(pendingConfirmation.chatId);
    if (!queue) {
      return;
    }

    const remaining = queue.filter((pending) => pending !== pendingConfirmation);
    if (remaining.length === 0) {
      this.pendingConfirmations.delete(pendingConfirmation.chatId);
      return;
    }

    this.pendingConfirmations.set(pendingConfirmation.chatId, remaining);
  }

  private clearPendingConfirmations(error: string): void {
    const pending = [...this.pendingConfirmations.values()].flat();
    for (const pendingConfirmation of pending) {
      this.removePendingConfirmation(pendingConfirmation);
      pendingConfirmation.log.success = false;
      pendingConfirmation.log.status = 'unconfirmed';
      pendingConfirmation.log.error = error;
    }
  }

  private isActiveClient(generation: number): boolean {
    return generation === this.clientGeneration;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async removeStaleAuthLock(): Promise<void> {
    const fs = await import('fs');
    const authFolder = process.env.AUTH_FOLDER || './auth';
    const lockFile = `${authFolder}/session-wa-gateway/SingletonLock`;

    try {
      if (fs.existsSync(lockFile)) {
        console.log('🧹 Removing stale lock file...');
        fs.unlinkSync(lockFile);
      }
    } catch (error) {
      console.warn('⚠️ Could not remove stale lock file:', getErrorMessage(error));
    }
  }

  private async replaceFailedClient(reason: string): Promise<void> {
    const failedClient = this.client;
    this.clientGeneration++;
    this.clearPendingConfirmations('Message confirmation unavailable because WhatsApp client is restarting.');

    failedClient.removeAllListeners();

    try {
      await failedClient.destroy();
      console.log(`🗑️ Destroyed failed WhatsApp client after ${reason}`);
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes("Cannot read properties of null (reading 'close')")) {
        console.log(`ℹ️ Skipped browser cleanup after ${reason} because Chrome never launched`);
      } else {
        console.warn(`⚠️ Failed to destroy WhatsApp client after ${reason}: ${message}`);
      }
    }

    this.resetConnectionState('RETRYING_INITIALIZE');
    this.createClient();
  }

  private scheduleReconnect(
    generation: number,
    replaceClient = false,
    reason = 'disconnect',
    delayMs = 10000
  ): void {
    if (this.reconnectTimer) {
      console.log('ℹ️ Reconnect already scheduled');
      return;
    }

    const delaySeconds = Math.round(delayMs / 1000);
    console.log(delayMs > 0
      ? `🔄 Attempting to reconnect in ${delaySeconds} seconds...`
      : '🔄 Attempting to reconnect now...');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (!this.isActiveClient(generation) || this.isLoggingOut || this.isShuttingDown) {
        console.log('ℹ️ Reconnect skipped because client lifecycle changed');
        if (replaceClient) {
          this.runtimeRecoveryInProgress = false;
        }
        return;
      }

      try {
        if (replaceClient) {
          await this.replaceFailedClient(reason);
        }

        await this.initialize();
      } catch (err) {
        console.error('❌ Reconnection failed:', err);
      } finally {
        if (replaceClient) {
          this.runtimeRecoveryInProgress = false;
        }
      }
    }, delayMs);
  }

  private resetConnectionState(state: string): void {
    this.isReady = false;
    this.connectionState.isConnected = false;
    this.connectionState.phoneNumber = undefined;
    this.connectionState.qrDisplayed = false;
    this.waState = state;
    this.qrCodeBase64 = null;
  }

  handleRuntimeError(error: unknown, source: string): boolean {
    if (!isTransientWhatsAppInjectionError(error)) {
      return false;
    }

    const message = getErrorMessage(error);
    this.connectionState.lastError = message;
    console.warn(`⚠️ Transient WhatsApp runtime error from ${source}, scheduling reconnect: ${message}`);

    this.startRuntimeRecovery(`runtime error from ${source}`);

    return true;
  }

  private startRuntimeRecovery(reason: string, delayMs = 10000): boolean {
    if (this.isLoggingOut || this.isShuttingDown) {
      return false;
    }

    if (this.runtimeRecoveryInProgress) {
      this.resetConnectionState('RECOVERING_RUNTIME');
      return false;
    }

    if (this.isInitializing) {
      return false;
    }

    this.resetConnectionState('RECOVERING_RUNTIME');
    this.runtimeRecoveryInProgress = true;
    this.clearReconnectTimer();
    this.scheduleReconnect(this.clientGeneration, true, reason, delayMs);

    return true;
  }

  requestReconnect(source: string): WhatsAppReconnectResult {
    if (this.isShuttingDown) {
      return {
        success: false,
        state: this.waState,
        message: 'Gateway is shutting down. Reconnect cannot be started.',
      };
    }

    if (this.isLoggingOut) {
      return {
        success: false,
        state: this.waState,
        message: 'WhatsApp logout is in progress. Wait until it finishes.',
      };
    }

    if (this.runtimeRecoveryInProgress || this.isInitializing) {
      return {
        success: true,
        state: this.waState,
        message: 'WhatsApp reconnect is already in progress.',
      };
    }

    this.connectionState.lastError = undefined;
    this.startRuntimeRecovery(`manual reconnect from ${source}`, 0);

    return {
      success: true,
      state: this.waState,
      message: 'WhatsApp reconnect started.',
    };
  }

  /**
   * Graceful shutdown
   */
  async destroy(): Promise<void> {
    console.log('🛑 Shutting down WhatsApp client...');
    this.isShuttingDown = true;
    this.clearReconnectTimer();
    this.clearPendingConfirmations('Message confirmation unavailable because the gateway is shutting down.');

    if (this.client) {
      try {
        await this.client.destroy();
        console.log('✅ WhatsApp client destroyed');
      } catch (error) {
        console.error('❌ Error destroying client:', error);
      }
    }

    this.resetConnectionState('SHUTDOWN');
  }

  /**
   * Logout and clear session, then recreate client for new QR
   */
  async logout(): Promise<WhatsAppLogoutResult> {
    console.log('🔓 Logging out...');
    if (!this.client) {
      return {
        success: true,
        state: this.waState,
        message: 'WhatsApp client is already unavailable',
      };
    }

    this.isLoggingOut = true;
    this.clearReconnectTimer();
    this.clearPendingConfirmations('Message confirmation unavailable because WhatsApp is logging out.');
    const oldClient = this.client;

    try {
      try {
        await oldClient.logout();
        console.log('✅ Logged out from WhatsApp');
      } catch (logoutError) {
        console.warn('⚠️ Logout failed, will destroy client anyway:', (logoutError as Error).message);
      }

      try {
        await oldClient.destroy();
        console.log('🗑️ Old client destroyed');
      } catch (destroyError) {
        console.warn('⚠️ Destroy failed, continuing:', (destroyError as Error).message);
      }

      oldClient.removeAllListeners();
      this.resetConnectionState('REINITIALIZING');

      console.log('🔄 Creating new client for QR code...');
      this.createClient();

      try {
        await this.initialize();
        console.log('✅ Ready for new QR scan');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reinitialize WhatsApp client';
        this.connectionState.lastError = message;
        this.waState = 'REINITIALIZE_FAILED';
        console.error('❌ Failed to reinitialize:', error);
        throw new Error('WhatsApp logout completed, but reconnect setup failed');
      }

      return {
        success: true,
        state: this.waState,
        message: 'Logged out successfully. Ready for a new QR scan.',
      };
    } finally {
      this.isLoggingOut = false;
    }
  }

  /**
   * Get QR code as base64 data URL
   */
  getQRCode(): string | null {
    return this.qrCodeBase64;
  }

  /**
   * Get message logs (most recent first)
   */
  getMessageLogs(): MessageLog[] {
    return [...this.messageLogs].reverse();
  }

  /**
   * Add entry to message log
   */
  private addMessageLog(log: MessageLog): void {
    this.messageLogs.push(log);
    // Keep only last MAX_LOGS entries
    if (this.messageLogs.length > this.MAX_LOGS) {
      this.messageLogs.shift();
    }
  }
}

// Singleton instance
export const whatsappService = new WhatsAppService();
