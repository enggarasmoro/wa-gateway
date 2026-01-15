import { Request, Response, NextFunction } from 'express';

/**
 * API Key Authentication Middleware
 * 
 * Validates requests using X-API-Key header
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.API_KEY;
  
  // Skip auth if API_KEY not configured (development mode)
  if (!apiKey) {
    console.warn('[Auth] API_KEY not set - authentication disabled');
    return next();
  }

  // Allow health check without auth
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  // Get API key from header
  const providedKey = req.headers['x-api-key'] as string;

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      status: 'error',
      message: 'Missing X-API-Key header',
    });
  }

  if (providedKey !== apiKey) {
    return res.status(403).json({
      success: false,
      status: 'error',
      message: 'Invalid API key',
    });
  }

  next();
}
