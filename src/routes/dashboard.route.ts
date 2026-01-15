import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { whatsappService } from '../services/whatsapp.service';
import { dashboardAuth } from '../middlewares/dashboard.auth';
import rateLimit from 'express-rate-limit';

const router = Router();

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
  const { username, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (!username || !password) {
    res.status(400).json({
      success: false,
      error: 'Username and password are required'
    });
    return;
  }

  const result = authService.login(username, password, ip);

  if (!result.success) {
    res.status(401).json({
      success: false,
      error: result.error
    });
    return;
  }

  res.json({
    success: true,
    token: result.token
  });
});

/**
 * GET /api/dashboard/status
 * Get WhatsApp connection status
 */
router.get('/dashboard/status', dashboardAuth, (req: Request, res: Response): void => {
  const state = whatsappService.getConnectionState();
  const waState = whatsappService.getWAState();
  const uptime = whatsappService.getUptime();
  const info = whatsappService.getInfo();
  const qrCode = whatsappService.getQRCode();

  res.json({
    success: true,
    data: {
      isConnected: state.isConnected,
      state: waState,
      phoneNumber: state.phoneNumber || info?.phoneNumber,
      name: info?.name,
      uptime,
      qrDisplayed: state.qrDisplayed,
      hasQR: !!qrCode,
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
  const { target, message } = req.body;

  if (!target || !message) {
    res.status(400).json({
      success: false,
      error: 'Target and message are required'
    });
    return;
  }

  const result = await whatsappService.sendMessage(target, message);
  res.json(result);
});

/**
 * POST /api/dashboard/logout
 * Logout WhatsApp session
 */
router.post('/dashboard/logout', dashboardAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await whatsappService.logout();
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Failed to logout: ${(error as Error).message}`
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
