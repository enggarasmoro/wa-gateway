import { Client, LocalAuth, Message, WAState } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import { ConnectionState, MessageResponse, SendMessageOptions, WhatsAppLogoutResult } from '../types';
import { formatPhoneNumber, PhoneNumberValidationError } from '../utils/phone.util';
import {
  createOperationContext,
  logOperationFinish,
  logOperationStart,
} from '../utils/logger.util';
import { readBooleanEnv, readIntegerEnv } from '../utils/env.util';
import {
  getErrorMessage,
  isTransientWhatsAppInjectionError,
  shouldReconnectAfterDisconnect,
} from './whatsapp-lifecycle.util';

// Message log entry
interface MessageLog {
  timestamp: Date;
  target: string;
  message: string;
  success: boolean;
  id?: string;
  error?: string;
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
  private readonly MAX_LOGS = 100;
  private lastReadinessLogAt: number = 0;
  private clientGeneration: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isInitializing: boolean = false;
  private isLoggingOut: boolean = false;
  private isShuttingDown: boolean = false;

  // Anti-ban features
  private dailyMessageCount: number = 0;
  private lastResetDate: string = new Date().toDateString();
  private readonly DAILY_MESSAGE_LIMIT = readIntegerEnv('DAILY_MESSAGE_LIMIT', 500, { min: 1, max: 100000 });
  private readonly TYPING_DELAY_MIN = 1000; // 1 second
  private readonly TYPING_DELAY_MAX = 3000; // 3 seconds
  private readonly INITIALIZE_RETRIES = readIntegerEnv('WHATSAPP_INITIALIZE_RETRIES', 2, { min: 0, max: 20 });
  private readonly INITIALIZE_RETRY_DELAY_MS = readIntegerEnv('WHATSAPP_INITIALIZE_RETRY_DELAY_MS', 5000, { min: 0, max: 300000 });
  private readonly AUTH_TIMEOUT_MS = readIntegerEnv('WHATSAPP_AUTH_TIMEOUT_MS', 120000, { min: 1000, max: 600000 });
  private readonly PUPPETEER_PROTOCOL_TIMEOUT_MS = readIntegerEnv('PUPPETEER_PROTOCOL_TIMEOUT_MS', 180000, { min: 1000, max: 600000 });
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
      puppeteer: {
        headless: true,
        protocolTimeout: this.PUPPETEER_PROTOCOL_TIMEOUT_MS,
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
    });

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

      if (msg.fromMe && process.env.LOG_LEVEL === 'debug') {
        console.log(`📤 Message sent to ${this.maskTarget(msg.to)}`);
      }
    });

    // Message acknowledgement (delivered, read, etc)
    client.on('message_ack', (msg: Message, ack: number) => {
      if (!this.isActiveClient(generation)) return;

      if (process.env.LOG_LEVEL === 'debug') {
        const ackStatus = ['ERROR', 'PENDING', 'SERVER', 'DEVICE', 'READ', 'PLAYED'];
        console.log(`✓ Message ${msg.id.id}: ${ackStatus[ack] || ack}`);
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

      // Anti-ban: Get chat and simulate typing
      try {
        const chat = await this.client.getChatById(chatId);
        await chat.sendStateTyping();
        console.log(`⌨️ Simulating typing...`);
        
        // Random typing delay (1-3 seconds)
        const typingDelay = this.randomDelay(this.TYPING_DELAY_MIN, this.TYPING_DELAY_MAX);
        await this.delay(typingDelay);
        await chat.clearState();
      } catch (typingError) {
        // Ignore typing errors, continue with sending
        console.log(`⚠️ Could not simulate typing, continuing...`);
      }

      // Send message with sendSeen: false to avoid markedUnread error
      const result = await this.client.sendMessage(chatId, message, {
        sendSeen: false,
      });

      // Increment daily counter
      this.dailyMessageCount++;

      console.log(`✅ Message sent to ${this.maskTarget(formattedNumber)} (ID: ${result.id.id}) [${this.dailyMessageCount}/${this.DAILY_MESSAGE_LIMIT}]`);

      // Log message
      this.addMessageLog({
        timestamp: new Date(),
        target: this.maskTarget(formattedNumber),
        message: this.getLoggedMessagePreview(message),
        success: true,
        id: result.id.id,
      });

      logOperationFinish(context, 'success', {
        target: this.maskTarget(formattedNumber),
        userId: options.userId,
        status: 'sent',
        messageId: result.id.id,
      });

      return {
        success: true,
        status: 'sent',
        message: 'Message sent successfully',
        target: formattedNumber,
        id: result.id.id,
      };
    } catch (error) {
      console.error(`❌ Error sending message:`, error);
      
      // Log error
      this.addMessageLog({
        timestamp: new Date(),
        target: this.maskTarget(formattedNumber),
        message: this.getLoggedMessagePreview(message),
        success: false,
        error: (error as Error).message,
      });

      logOperationFinish(context, 'failure', {
        target: this.maskTarget(formattedNumber),
        userId: options.userId,
        status: 'error',
        error: (error as Error).message,
      });

      return {
        success: false,
        status: 'error',
        message: 'Failed to send message. Check gateway logs for details.',
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
    if (this.isReady && this.connectionState.isConnected) {
      return true;
    }

    if (this.isInitializing || ['ERROR', 'RETRYING_INITIALIZE', 'IDLE'].includes(this.waState)) {
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
      return false;
    } catch (error) {
      const err = error as Error;
      this.connectionState.lastError = err.message;

      const now = Date.now();
      if (now - this.lastReadinessLogAt > 30000) {
        console.warn(`⚠️ Unable to refresh WhatsApp readiness during ${operation}: ${err.message}`);
        this.lastReadinessLogAt = now;
      }

      return false;
    }
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

  private scheduleReconnect(generation: number): void {
    this.clearReconnectTimer();
    console.log('🔄 Attempting to reconnect in 10 seconds...');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (!this.isActiveClient(generation) || this.isLoggingOut || this.isShuttingDown) {
        console.log('ℹ️ Reconnect skipped because client lifecycle changed');
        return;
      }

      this.initialize().catch((err) => {
        console.error('❌ Reconnection failed:', err);
      });
    }, 10000);
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
    console.warn(`⚠️ Ignored transient WhatsApp runtime error from ${source}: ${message}`);

    if (!this.isReady && !this.isInitializing && !this.isLoggingOut && !this.isShuttingDown) {
      this.scheduleReconnect(this.clientGeneration);
    }

    return true;
  }

  /**
   * Graceful shutdown
   */
  async destroy(): Promise<void> {
    console.log('🛑 Shutting down WhatsApp client...');
    this.isShuttingDown = true;
    this.clearReconnectTimer();

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
