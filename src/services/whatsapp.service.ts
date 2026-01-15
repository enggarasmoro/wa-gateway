import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import * as path from 'path';
import { ConnectionState, MessageResponse } from '../types';
import { toWhatsAppJid, formatPhoneNumber } from '../utils/phone.util';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

class WhatsAppService {
  private socket: WASocket | null = null;
  private connectionState: ConnectionState = {
    isConnected: false,
    startTime: new Date(),
    qrDisplayed: false,
  };
  private messageDelay: number;
  private authFolder: string;

  constructor() {
    this.messageDelay = parseInt(process.env.MESSAGE_DELAY_MS || '1000', 10);
    this.authFolder = process.env.AUTH_FOLDER || './auth';
  }

  /**
   * Initialize WhatsApp connection
   */
  async initialize(): Promise<void> {
    const authPath = path.resolve(this.authFolder);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We'll handle QR display ourselves
      logger: pino({ level: 'silent' }),
      // Use proper browser fingerprint to avoid 405 error
      browser: ['Ubuntu', 'Chrome', '120.0.6099.109'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 2000,
      // Improve connection stability
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Handle connection updates
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Display QR code when available
      if (qr) {
        console.log('\n');
        console.log('='.repeat(50));
        console.log('📱 SCAN QR CODE BELOW WITH WHATSAPP');
        console.log('='.repeat(50));
        qrcode.generate(qr, { small: true });
        console.log('='.repeat(50));
        console.log('\n');
        this.connectionState.qrDisplayed = true;
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;

        logger.info(
          `Connection closed. Reason: ${
            (lastDisconnect?.error as Boom)?.output?.statusCode
          }. Reconnecting: ${shouldReconnect}`
        );

        this.connectionState.isConnected = false;

        if (shouldReconnect) {
          // Wait before reconnecting
          await this.delay(5000);
          await this.initialize();
        } else {
          logger.error('Logged out. Please delete auth folder and scan QR again.');
        }
      } else if (connection === 'open') {
        logger.info('✅ WhatsApp connection established!');
        this.connectionState.isConnected = true;
        this.connectionState.qrDisplayed = false;

        // Get connected phone number
        const me = this.socket?.user;
        if (me) {
          this.connectionState.phoneNumber = me.id.split(':')[0];
          logger.info(`📱 Connected as: ${this.connectionState.phoneNumber}`);
        }
      }
    });

    // Save credentials on update
    this.socket.ev.on('creds.update', saveCreds);

    // Handle messages (for debugging)
    this.socket.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            const sender = msg.key.remoteJid;
            const text =
              msg.message.conversation ||
              msg.message.extendedTextMessage?.text ||
              '[media]';
            logger.debug(`Received message from ${sender}: ${text}`);
          }
        }
      }
    });
  }

  /**
   * Send a single message
   */
  async sendMessage(target: string, message: string): Promise<MessageResponse> {
    if (!this.socket || !this.connectionState.isConnected) {
      return {
        success: false,
        status: 'disconnected',
        message: 'WhatsApp is not connected. Please scan QR code.',
      };
    }

    try {
      const jid = toWhatsAppJid(target);
      const formattedNumber = formatPhoneNumber(target);

      logger.info(`Sending message to: ${formattedNumber}`);

      const result = await this.socket.sendMessage(jid, { text: message });

      logger.info(`✅ Message sent to ${formattedNumber}`);

      return {
        success: true,
        status: 'sent',
        message: 'Message sent successfully',
        target: formattedNumber,
        id: result?.key?.id ?? undefined,
      };
    } catch (error) {
      logger.error(`Error sending message: ${error}`);
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

    for (const target of targets) {
      const result = await this.sendMessage(target, message);
      results.push(result);

      // Add delay between messages to avoid spam detection
      if (targets.indexOf(target) < targets.length - 1) {
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
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState.isConnected;
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
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const whatsappService = new WhatsAppService();
