import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { whatsappService } from '../services/whatsapp.service';
import { dashboardAuth } from '../middlewares/dashboard.auth';
import { SendMessageOptions } from '../types';
import {
  RequestValidationError,
  validateLoginRequest,
  validateSendRequest,
} from '../utils/request-validation.util';
import { getMessageResponseHttpStatus } from '../utils/http-status.util';
import rateLimit from 'express-rate-limit';

const router = Router();

function getSendOptions(res: Response): SendMessageOptions {
  return {
    correlationId: typeof res.locals.correlationId === 'string' ? res.locals.correlationId : undefined,
    userId: typeof res.locals.userId === 'string' ? res.locals.userId : undefined,
  };
}

// Rate limiter for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { success: false, error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/auth/login
 * Login to dashboard
 */
router.post('/auth/login', loginLimiter, (req: Request, res: Response): void => {
  let credentials;
  try {
    credentials = validateLoginRequest(req.body);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
      return;
    }

    console.error('Error validating login request:', error);
    res.status(400).json({
      success: false,
      error: 'Invalid login request',
    });
    return;
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  const result = authService.login(credentials.username, credentials.password, ip);

  if (!result.success) {
    res.status(401).json({
      success: false,
      error: result.error
    });
    return;
  }

  res.locals.userId = credentials.username;
  res.json({
    success: true,
    token: result.token
  });
});

/**
 * GET /api/dashboard/status
 * Get WhatsApp connection status
 */
router.get('/dashboard/status', dashboardAuth, async (req: Request, res: Response): Promise<void> => {
  const state = await whatsappService.refreshConnectionState('dashboard/status');
  const waState = whatsappService.getWAState();
  const uptime = whatsappService.getUptime();
  const info = whatsappService.getInfo();
  const qrCode = whatsappService.getQRCode();

  res.json({
    success: true,
    data: {
      isConnected: state.isConnected,
      isReady: state.isReady,
      state: waState,
      phoneNumber: state.phoneNumber || info?.phoneNumber,
      name: info?.name,
      uptime,
      qrDisplayed: state.qrDisplayed,
      hasQR: !!qrCode,
      lastError: state.lastError,
    }
  });
});

/**
 * GET /api/dashboard/qr
 * Get QR code as base64 image
 */
router.get('/dashboard/qr', dashboardAuth, async (req: Request, res: Response): Promise<void> => {
  const qrCode = whatsappService.getQRCode();

  if (!qrCode) {
    res.status(404).json({
      success: false,
      error: 'No QR code available. Already connected or not initialized.'
    });
    return;
  }

  res.json({
    success: true,
    data: {
      qrCode
    }
  });
});

/**
 * POST /api/dashboard/send
 * Send a test message
 */
router.post('/dashboard/send', dashboardAuth, async (req: Request, res: Response): Promise<void> => {
  let request;
  try {
    request = validateSendRequest(req.body);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
      return;
    }

    console.error('Error validating dashboard send request:', error);
    res.status(400).json({
      success: false,
      error: 'Invalid send request',
    });
    return;
  }

  if (request.targets.length > 1) {
    res.status(400).json({
      success: false,
      status: 'error',
      message: 'Dashboard test send accepts one target only',
    });
    return;
  }

  const result = await whatsappService.sendMessage(request.targets[0], request.message, getSendOptions(res));
  res.status(getMessageResponseHttpStatus(result)).json(result);
});

/**
 * POST /api/dashboard/logout
 * Logout WhatsApp session
 */
router.post('/dashboard/logout', dashboardAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await whatsappService.logout();
    res.json({
      success: result.success,
      state: result.state,
      message: result.message
    });
  } catch (error) {
    console.error('Error during WhatsApp logout:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to logout WhatsApp. Check gateway logs for details.'
    });
  }
});

/**
 * GET /api/dashboard/logs
 * Get message history
 */
router.get('/dashboard/logs', dashboardAuth, (req: Request, res: Response): void => {
  const logs = whatsappService.getMessageLogs();
  res.json({
    success: true,
    data: logs
  });
});

export default router;
