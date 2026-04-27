import { Router, Request, Response } from 'express';
import { whatsappService } from '../services/whatsapp.service';
import { HealthResponse, SendMessageOptions } from '../types';
import {
  RequestValidationError,
  validateBroadcastRequest,
  validateSendRequest,
} from '../utils/request-validation.util';
import { getMessageResponseHttpStatus, getMessageResponsesHttpStatus } from '../utils/http-status.util';

const router = Router();

function getSendOptions(res: Response): SendMessageOptions {
  return {
    correlationId: typeof res.locals.correlationId === 'string' ? res.locals.correlationId : undefined,
    userId: typeof res.locals.userId === 'string' ? res.locals.userId : undefined,
  };
}

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
    const { targets, message } = validateSendRequest(req.body);
    
    if (targets.length > 1) {
      // Multiple targets - send as broadcast
      const results = await whatsappService.sendBroadcast(targets, message, getSendOptions(res));
      const allSuccess = results.every((r) => r.success);
      
      return res.status(getMessageResponsesHttpStatus(results)).json({
        success: allSuccess,
        status: allSuccess ? 'sent' : 'partial',
        message: `Sent to ${results.filter((r) => r.success).length}/${results.length} targets`,
        results,
      });
    }

    // Single target
    const result = await whatsappService.sendMessage(targets[0], message, getSendOptions(res));

    return res.status(getMessageResponseHttpStatus(result)).json(result);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: error.message,
      });
    }

    console.error('Error in /send endpoint:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Internal server error',
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
    const { targets, message } = validateBroadcastRequest(req.body);

    const results = await whatsappService.sendBroadcast(targets, message, getSendOptions(res));
    const successCount = results.filter((r) => r.success).length;
    const allSuccess = successCount === results.length;

    return res.status(getMessageResponsesHttpStatus(results)).json({
      success: allSuccess,
      status: allSuccess ? 'sent' : 'partial',
      message: `Sent to ${successCount}/${results.length} targets`,
      total: results.length,
      sent: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: error.message,
      });
    }

    console.error('Error in /broadcast endpoint:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Internal server error',
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  const state = await whatsappService.refreshConnectionState('api/health');

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
router.get('/status', async (req: Request, res: Response) => {
  const state = await whatsappService.refreshConnectionState('api/status');

  return res.json({
    connected: state.isConnected,
    ready: state.isReady,
    phoneNumber: state.phoneNumber,
    uptime: whatsappService.getUptime(),
    uptimeFormatted: formatUptime(whatsappService.getUptime()),
    startTime: state.startTime.toISOString(),
    qrDisplayed: state.qrDisplayed,
    lastError: state.lastError,
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
