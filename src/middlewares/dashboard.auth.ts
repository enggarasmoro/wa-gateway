import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';

/**
 * Dashboard JWT Authentication Middleware
 */
export function dashboardAuth(req: Request, res: Response, next: NextFunction): void {
  // Get token from Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'No token provided'
    });
    return;
  }

  const token = authHeader.substring(7);
  const { valid, payload } = authService.verifyToken(token);

  if (!valid) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
    return;
  }

  // Attach user info to request
  (req as any).user = payload;
  next();
}
