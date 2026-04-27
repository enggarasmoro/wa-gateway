import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { loadSecurityConfig } from '../config/security.config';

const { apiKey } = loadSecurityConfig();

export function isApiKeyMatch(providedKey: unknown, expectedKey: string): boolean {
  if (typeof providedKey !== 'string') {
    return false;
  }

  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * API Key Authentication Middleware
 * 
 * Validates requests using X-API-Key header
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // Allow health check without auth
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  // Get API key from header
  const providedKey = req.headers['x-api-key'];

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      status: 'error',
      message: 'Missing X-API-Key header',
    });
  }

  if (!isApiKeyMatch(providedKey, apiKey)) {
    return res.status(403).json({
      success: false,
      status: 'error',
      message: 'Invalid API key',
    });
  }

  next();
}
