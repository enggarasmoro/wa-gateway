import { Request, Response, NextFunction } from 'express';
import {
  authService,
  DASHBOARD_TOKEN_COOKIE,
  DashboardTokenPayload,
  getCookieValue,
} from '../services/auth.service';

interface AuthenticatedDashboardRequest extends Request {
  user?: DashboardTokenPayload;
}

/**
 * Dashboard JWT Authentication Middleware
 */
export function dashboardAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : undefined;
  const cookieToken = getCookieValue(req.headers.cookie, DASHBOARD_TOKEN_COOKIE);
  const token = bearerToken || cookieToken;
  
  if (!token) {
    res.status(401).json({
      success: false,
      error: 'No token provided'
    });
    return;
  }

  const { valid, payload } = authService.verifyToken(token);

  if (!valid || !payload) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
    return;
  }

  // Attach user info to request
  (req as AuthenticatedDashboardRequest).user = payload;
  res.locals.userId = payload.username;
  next();
}
