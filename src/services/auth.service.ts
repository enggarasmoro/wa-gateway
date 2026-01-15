import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.API_KEY || 'default-secret-change-me';
const JWT_EXPIRY = '1h';

// Default credentials (should be changed via env)
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || process.env.API_KEY || 'admin';

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
    this.passwordHash = bcrypt.hashSync(DASHBOARD_PASSWORD, 10);
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
  verifyToken(token: string): { valid: boolean; payload?: any } {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return { valid: true, payload };
    } catch (error) {
      return { valid: false };
    }
  }
}

export const authService = new AuthService();
