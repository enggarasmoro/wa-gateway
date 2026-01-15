import { Router, Request, Response } from 'express';
import { whatsappService } from '../services/whatsapp.service';
import { SendMessageRequest, BroadcastRequest, HealthResponse } from '../types';
import { formatPhoneNumber, parseTargets } from '../utils/phone.util';

const router = Router();

/**
 * POST /api/send
 * Send a single WhatsApp message
 * 
 * Request body:
 * {
 *   "target": "6281234567890",
 *   "message": "Hello World"
 * }
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { target, message, countryCode }: SendMessageRequest = req.body;

    // Validate request
    if (!target || !message) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: 'Missing required fields: target and message',
      });
    }

    // Handle comma-separated targets (for backward compatibility with Fonnte)
    const targets = parseTargets(target);
    
    if (targets.length > 1) {
      // Multiple targets - send as broadcast
      const results = await whatsappService.sendBroadcast(targets, message);
      const allSuccess = results.every((r) => r.success);
      
      return res.status(allSuccess ? 200 : 207).json({
        success: allSuccess,
        status: allSuccess ? 'sent' : 'partial',
        message: `Sent to ${results.filter((r) => r.success).length}/${results.length} targets`,
        results,
      });
    }

    // Single target
    const result = await whatsappService.sendMessage(targets[0], message);

    return res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('Error in /send endpoint:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: `Internal server error: ${(error as Error).message}`,
    });
  }
});

/**
 * POST /api/broadcast
 * Send WhatsApp message to multiple targets
 * 
 * Request body:
 * {
 *   "targets": ["6281234567890", "6289876543210"],
 *   "message": "Broadcast message"
 * }
 */
router.post('/broadcast', async (req: Request, res: Response) => {
  try {
    const { targets, message }: BroadcastRequest = req.body;

    // Validate request
    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: 'Missing or invalid required field: targets (must be non-empty array)',
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: 'Missing required field: message',
      });
    }

    const results = await whatsappService.sendBroadcast(targets, message);
    const successCount = results.filter((r) => r.success).length;
    const allSuccess = successCount === results.length;

    return res.status(allSuccess ? 200 : 207).json({
      success: allSuccess,
      status: allSuccess ? 'sent' : 'partial',
      message: `Sent to ${successCount}/${results.length} targets`,
      total: results.length,
      sent: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (error) {
    console.error('Error in /broadcast endpoint:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: `Internal server error: ${(error as Error).message}`,
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  const state = whatsappService.getConnectionState();

  const response: HealthResponse = {
    status: state.isConnected ? 'connected' : 'disconnected',
    uptime: whatsappService.getUptime(),
    phone: state.phoneNumber,
    timestamp: new Date().toISOString(),
  };

  return res.status(state.isConnected ? 200 : 503).json(response);
});

/**
 * GET /status
 * Detailed status endpoint
 */
router.get('/status', (req: Request, res: Response) => {
  const state = whatsappService.getConnectionState();

  return res.json({
    connected: state.isConnected,
    phoneNumber: state.phoneNumber,
    uptime: whatsappService.getUptime(),
    uptimeFormatted: formatUptime(whatsappService.getUptime()),
    startTime: state.startTime.toISOString(),
    qrDisplayed: state.qrDisplayed,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Format uptime to human readable string
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

export default router;
