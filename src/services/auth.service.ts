import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { JwtPayload } from 'jsonwebtoken';
import { loadSecurityConfig } from '../config/security.config';

const securityConfig = loadSecurityConfig();
const JWT_SECRET = securityConfig.jwtSecret;
const JWT_EXPIRY = '1h';

const DASHBOARD_USERNAME = securityConfig.dashboardUsername;
const DASHBOARD_PASSWORD = securityConfig.dashboardPassword;
const BCRYPT_ROUNDS = securityConfig.bcryptRounds;

export interface DashboardTokenPayload extends JwtPayload {
  username: string;
  role: 'admin';
}

// Login attempt tracking for rate limiting
interface LoginAttempt {
  count: number;
  lastAttempt: Date;
  lockedUntil?: Date;
}

const loginAttempts: Map<string, LoginAttempt> = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Auth Service for Dashboard
 */
class AuthService {
  private passwordHash: string;

  constructor() {
    // Hash password on startup
    this.passwordHash = bcrypt.hashSync(DASHBOARD_PASSWORD, BCRYPT_ROUNDS);
  }

  /**
   * Check if IP is locked out
   */
  isLockedOut(ip: string): boolean {
    const attempt = loginAttempts.get(ip);
    if (!attempt?.lockedUntil) return false;
    
    if (new Date() > attempt.lockedUntil) {
      // Lock expired, reset
      loginAttempts.delete(ip);
      return false;
    }
    
    return true;
  }

  /**
   * Get remaining lockout time in seconds
   */
  getLockoutRemaining(ip: string): number {
    const attempt = loginAttempts.get(ip);
    if (!attempt?.lockedUntil) return 0;
    
    const remaining = attempt.lockedUntil.getTime() - Date.now();
    return Math.ceil(remaining / 1000);
  }

  /**
   * Record failed login attempt
   */
  recordFailedAttempt(ip: string): void {
    const attempt = loginAttempts.get(ip) || { count: 0, lastAttempt: new Date() };
    attempt.count++;
    attempt.lastAttempt = new Date();
    
    if (attempt.count >= MAX_ATTEMPTS) {
      attempt.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    }
    
    loginAttempts.set(ip, attempt);
  }

  /**
   * Clear login attempts for IP
   */
  clearAttempts(ip: string): void {
    loginAttempts.delete(ip);
  }

  /**
   * Validate credentials and return JWT token
   */
  login(username: string, password: string, ip: string): { success: boolean; token?: string; error?: string } {
    // Check lockout
    if (this.isLockedOut(ip)) {
      const remaining = this.getLockoutRemaining(ip);
      return {
        success: false,
        error: `Too many failed attempts. Try again in ${Math.ceil(remaining / 60)} minutes.`
      };
    }

    // Validate username
    if (username !== DASHBOARD_USERNAME) {
      this.recordFailedAttempt(ip);
      return { success: false, error: 'Invalid credentials' };
    }

    // Validate password
    if (!bcrypt.compareSync(password, this.passwordHash)) {
      this.recordFailedAttempt(ip);
      return { success: false, error: 'Invalid credentials' };
    }

    // Success - clear attempts and generate token
    this.clearAttempts(ip);
    
    const token = jwt.sign(
      { username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    return { success: true, token };
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): { valid: boolean; payload?: DashboardTokenPayload } {
    try {
      const payload = jwt.verify(token, JWT_SECRET);

      if (
        !payload ||
        typeof payload !== 'object' ||
        typeof payload.username !== 'string' ||
        payload.role !== 'admin'
      ) {
        return { valid: false };
      }

      return { valid: true, payload: payload as DashboardTokenPayload };
    } catch (error) {
      return { valid: false };
    }
  }
}

export const authService = new AuthService();
