import { Client, LocalAuth, Message, WAState } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { ConnectionState, MessageResponse } from '../types';
import { formatPhoneNumber } from '../utils/phone.util';

/**
 * WhatsApp Service using whatsapp-web.js
 * Following best practices from https://docs.wwebjs.dev/
 */
class WhatsAppService {
  private client: Client;
  private connectionState: ConnectionState = {
    isConnected: false,
    startTime: new Date(),
    qrDisplayed: false,
  };
  private messageDelay: number;
  private isReady: boolean = false;
  private waState: string = 'INITIALIZING';

  constructor() {
    this.messageDelay = parseInt(process.env.MESSAGE_DELAY_MS || '1000', 10);
    const authFolder = process.env.AUTH_FOLDER || './auth';

    // Initialize client with LocalAuth for session persistence
    // Ref: https://docs.wwebjs.dev/LocalAuth.html
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: authFolder,
        clientId: 'wa-gateway',
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
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
      // Web version cache for faster startup
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      },
    });

    this.setupEventHandlers();
  }

  /**
   * Setup all event handlers
   * Ref: https://docs.wwebjs.dev/global.html#Events
   */
  private setupEventHandlers(): void {
    // QR Code received - User needs to scan
    this.client.on('qr', (qr: string) => {
      console.log('\n');
      console.log('═'.repeat(50));
      console.log('📱 SCAN QR CODE WITH WHATSAPP');
      console.log('═'.repeat(50));
      qrcode.generate(qr, { small: true });
      console.log('═'.repeat(50));
      console.log('\n');
      this.connectionState.qrDisplayed = true;
      this.waState = 'WAITING_FOR_QR_SCAN';
    });

    // Loading screen progress
    this.client.on('loading_screen', (percent: number, message: string) => {
      console.log(`⏳ Loading: ${percent}% - ${message}`);
    });

    // Authentication successful (after QR scan)
    this.client.on('authenticated', () => {
      console.log('🔐 Authentication successful!');
      this.waState = 'AUTHENTICATED';
    });

    // Client is ready to send/receive messages
    this.client.on('ready', () => {
      console.log('✅ WhatsApp client is ready!');
      this.connectionState.isConnected = true;
      this.connectionState.qrDisplayed = false;
      this.isReady = true;
      this.waState = 'CONNECTED';

      // Get connected phone info
      const info = this.client.info;
      if (info) {
        this.connectionState.phoneNumber = info.wid.user;
        console.log(`📱 Connected as: +${this.connectionState.phoneNumber}`);
        console.log(`� Name: ${info.pushname || 'Unknown'}`);
      }
    });

    // Authentication failure
    this.client.on('auth_failure', (msg: string) => {
      console.error('❌ Authentication failed:', msg);
      console.error('💡 Try deleting the auth folder and restarting');
      this.connectionState.isConnected = false;
      this.isReady = false;
      this.waState = 'AUTH_FAILURE';
    });

    // State changed (CONFLICT, CONNECTED, DEPRECATED, OPENING, PAIRING, PROXYBLOCK,
    // SMB_TOS_BLOCK, TIMEOUT, TOS_BLOCK, UNLAUNCHED, UNPAIRED, UNPAIRED_IDLE)
    this.client.on('change_state', (state: WAState) => {
      console.log(`📊 State changed: ${state}`);
      this.waState = state;
    });

    // Disconnected from WhatsApp
    this.client.on('disconnected', (reason: string) => {
      console.log('📴 Disconnected:', reason);
      this.connectionState.isConnected = false;
      this.isReady = false;
      this.waState = 'DISCONNECTED';

      // Attempt to reconnect
      console.log('🔄 Attempting to reconnect in 10 seconds...');
      setTimeout(() => {
        this.initialize().catch((err) => {
          console.error('❌ Reconnection failed:', err);
        });
      }, 10000);
    });

    // Message received (for logging/debugging)
    this.client.on('message', (msg: Message) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`📩 Message from ${msg.from}: ${msg.body.substring(0, 50)}...`);
      }
    });

    // Message sent by us
    this.client.on('message_create', (msg: Message) => {
      if (msg.fromMe && process.env.LOG_LEVEL === 'debug') {
        console.log(`📤 Message sent to ${msg.to}: ${msg.body.substring(0, 50)}...`);
      }
    });

    // Message acknowledgement (delivered, read, etc)
    this.client.on('message_ack', (msg: Message, ack: number) => {
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
    console.log('📱 Initializing WhatsApp connection...');
    this.waState = 'INITIALIZING';
    
    try {
      await this.client.initialize();
    } catch (error) {
      console.error('❌ Failed to initialize:', error);
      this.waState = 'ERROR';
      throw error;
    }
  }

  /**
   * Send a single message
   */
  async sendMessage(target: string, message: string): Promise<MessageResponse> {
    if (!this.isReady) {
      return {
        success: false,
        status: 'disconnected',
        message: 'WhatsApp is not connected. Please scan QR code.',
      };
    }

    try {
      const formattedNumber = formatPhoneNumber(target);
      // whatsapp-web.js format: number@c.us
      const chatId = `${formattedNumber}@c.us`;

      console.log(`📤 Sending message to: +${formattedNumber}`);

      // Check if number is registered on WhatsApp
      const isRegistered = await this.client.isRegisteredUser(chatId);
      if (!isRegistered) {
        console.log(`⚠️ Number +${formattedNumber} is not registered on WhatsApp`);
        return {
          success: false,
          status: 'invalid_number',
          message: `Number +${formattedNumber} is not registered on WhatsApp`,
          target: formattedNumber,
        };
      }

      const result = await this.client.sendMessage(chatId, message);

      console.log(`✅ Message sent to +${formattedNumber} (ID: ${result.id.id})`);

      return {
        success: true,
        status: 'sent',
        message: 'Message sent successfully',
        target: formattedNumber,
        id: result.id.id,
      };
    } catch (error) {
      console.error(`❌ Error sending message:`, error);
      return {
        success: false,
        status: 'error',
        message: `Failed to send message: ${(error as Error).message}`,
        target: formatPhoneNumber(target),
      };
    }
  }

  /**
   * Send broadcast messages to multiple targets
   */
  async sendBroadcast(targets: string[], message: string): Promise<MessageResponse[]> {
    const results: MessageResponse[] = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const result = await this.sendMessage(target, message);
      results.push(result);

      // Add delay between messages to avoid spam detection
      if (i < targets.length - 1) {
        await this.delay(this.messageDelay);
      }
    }

    return results;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return { ...this.connectionState };
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
   * Graceful shutdown
   */
  async destroy(): Promise<void> {
    console.log('🛑 Shutting down WhatsApp client...');
    if (this.client) {
      try {
        await this.client.destroy();
        console.log('✅ WhatsApp client destroyed');
      } catch (error) {
        console.error('❌ Error destroying client:', error);
      }
    }
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    console.log('🔓 Logging out...');
    if (this.client) {
      try {
        await this.client.logout();
        console.log('✅ Logged out successfully');
      } catch (error) {
        console.error('❌ Error logging out:', error);
      }
    }
  }
}

// Singleton instance
export const whatsappService = new WhatsAppService();
