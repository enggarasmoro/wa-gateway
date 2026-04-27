const INSECURE_SECRET_VALUES = new Set([
  'admin',
  'changeme',
  'change-me',
  'default-secret-change-me',
  'your-api-key',
  'your-secure-api-key-here',
  'your-dashboard-password',
  'your-jwt-secret-key',
]);

function isProductionLike(): boolean {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  const appEnv = process.env.APP_ENV?.toLowerCase();
  return nodeEnv === 'production' || appEnv === 'production' || appEnv === 'staging';
}

function readRequiredSecret(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured`);
  }

  const normalizedValue = value.toLowerCase();

  if (INSECURE_SECRET_VALUES.has(normalizedValue) || normalizedValue.startsWith('replace-with-')) {
    throw new Error(`${name} uses an insecure default value`);
  }

  return value;
}

function readRequiredUsername(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured`);
  }

  const normalizedValue = value.toLowerCase();

  if (normalizedValue.startsWith('replace-with-')) {
    throw new Error(`${name} uses an insecure placeholder value`);
  }

  if (isProductionLike() && normalizedValue === 'admin') {
    throw new Error(`${name} must not use the default admin username in production-like environments`);
  }

  return value;
}

function readBcryptRounds(): number {
  const rawValue = process.env.DASHBOARD_BCRYPT_ROUNDS?.trim() || '12';
  const rounds = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(rounds) || rounds < 12) {
    throw new Error('DASHBOARD_BCRYPT_ROUNDS must be an integer greater than or equal to 12');
  }

  return rounds;
}

export interface SecurityConfig {
  apiKey: string;
  dashboardUsername: string;
  dashboardPassword: string;
  jwtSecret: string;
  bcryptRounds: number;
}

export function loadSecurityConfig(): SecurityConfig {
  return {
    apiKey: readRequiredSecret('API_KEY'),
    dashboardUsername: readRequiredUsername('DASHBOARD_USERNAME'),
    dashboardPassword: readRequiredSecret('DASHBOARD_PASSWORD'),
    jwtSecret: readRequiredSecret('JWT_SECRET'),
    bcryptRounds: readBcryptRounds(),
  };
}
