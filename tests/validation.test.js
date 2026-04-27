const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatPhoneNumber,
  parseTargets,
  PhoneNumberValidationError,
} = require('../dist/utils/phone.util');
const {
  RequestValidationError,
  validateBroadcastRequest,
  validateLoginRequest,
  validateSendRequest,
} = require('../dist/utils/request-validation.util');
const {
  getMessageResponseHttpStatus,
  getMessageResponsesHttpStatus,
} = require('../dist/utils/http-status.util');
const { loadSecurityConfig } = require('../dist/config/security.config');

process.env.API_KEY = process.env.API_KEY || 'safe-api-key-for-tests';
process.env.DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'operator';
process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'safe-dashboard-password';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'safe-jwt-secret';

const { isApiKeyMatch } = require('../dist/middlewares/auth.middleware');
const { shouldReconnectAfterDisconnect } = require('../dist/services/whatsapp-lifecycle.util');

test('formatPhoneNumber normalizes Indonesian local numbers', () => {
  assert.equal(formatPhoneNumber('0812-3456-7890'), '6281234567890');
});

test('formatPhoneNumber rejects malformed numbers', () => {
  assert.throws(
    () => formatPhoneNumber('abc'),
    PhoneNumberValidationError
  );
});

test('parseTargets rejects empty target lists', () => {
  assert.throws(
    () => parseTargets(' , '),
    PhoneNumberValidationError
  );
});

test('validateSendRequest returns normalized targets and message', () => {
  const request = validateSendRequest({
    target: '0812-3456-7890, 6281234567891',
    message: 'hello',
  });

  assert.deepEqual(request.targets, ['6281234567890', '6281234567891']);
  assert.equal(request.message, 'hello');
});

test('validateSendRequest rejects non-string message', () => {
  assert.throws(
    () => validateSendRequest({ target: '081234567890', message: 123 }),
    RequestValidationError
  );
});

test('validateSendRequest wraps invalid phone numbers as request validation errors', () => {
  assert.throws(
    () => validateSendRequest({ target: 'abc', message: 'hello' }),
    RequestValidationError
  );
});

test('validateBroadcastRequest rejects empty target arrays', () => {
  assert.throws(
    () => validateBroadcastRequest({ targets: [], message: 'hello' }),
    RequestValidationError
  );
});

test('validateLoginRequest rejects non-string credentials', () => {
  assert.throws(
    () => validateLoginRequest({ username: 'operator', password: 123 }),
    RequestValidationError
  );
});

test('validateLoginRequest trims valid credentials', () => {
  const request = validateLoginRequest({
    username: ' operator ',
    password: ' safe-dashboard-password ',
  });

  assert.deepEqual(request, {
    username: 'operator',
    password: 'safe-dashboard-password',
  });
});

test('loadSecurityConfig rejects missing required secrets', () => {
  const previous = {
    API_KEY: process.env.API_KEY,
    DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
    JWT_SECRET: process.env.JWT_SECRET,
    DASHBOARD_BCRYPT_ROUNDS: process.env.DASHBOARD_BCRYPT_ROUNDS,
  };

  delete process.env.API_KEY;
  process.env.DASHBOARD_USERNAME = 'operator';
  process.env.DASHBOARD_PASSWORD = 'safe-dashboard-password';
  process.env.JWT_SECRET = 'safe-jwt-secret';
  delete process.env.DASHBOARD_BCRYPT_ROUNDS;

  try {
    assert.throws(() => loadSecurityConfig(), /API_KEY must be configured/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('loadSecurityConfig rejects placeholder secret values', () => {
  const previous = {
    API_KEY: process.env.API_KEY,
    DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
    JWT_SECRET: process.env.JWT_SECRET,
    DASHBOARD_BCRYPT_ROUNDS: process.env.DASHBOARD_BCRYPT_ROUNDS,
  };

  process.env.API_KEY = 'replace-with-a-long-random-api-key';
  process.env.DASHBOARD_USERNAME = 'operator';
  process.env.DASHBOARD_PASSWORD = 'safe-dashboard-password';
  process.env.JWT_SECRET = 'safe-jwt-secret';
  delete process.env.DASHBOARD_BCRYPT_ROUNDS;

  try {
    assert.throws(() => loadSecurityConfig(), /API_KEY uses an insecure default value/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('loadSecurityConfig rejects placeholder dashboard username', () => {
  const previous = {
    API_KEY: process.env.API_KEY,
    DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
    JWT_SECRET: process.env.JWT_SECRET,
    DASHBOARD_BCRYPT_ROUNDS: process.env.DASHBOARD_BCRYPT_ROUNDS,
  };

  process.env.API_KEY = 'safe-api-key-for-tests';
  process.env.DASHBOARD_USERNAME = 'replace-with-dashboard-username';
  process.env.DASHBOARD_PASSWORD = 'safe-dashboard-password';
  process.env.JWT_SECRET = 'safe-jwt-secret';
  delete process.env.DASHBOARD_BCRYPT_ROUNDS;

  try {
    assert.throws(() => loadSecurityConfig(), /DASHBOARD_USERNAME uses an insecure placeholder value/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('loadSecurityConfig rejects bcrypt rounds below security minimum', () => {
  const previous = {
    API_KEY: process.env.API_KEY,
    DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
    JWT_SECRET: process.env.JWT_SECRET,
    DASHBOARD_BCRYPT_ROUNDS: process.env.DASHBOARD_BCRYPT_ROUNDS,
  };

  process.env.API_KEY = 'safe-api-key-for-tests';
  process.env.DASHBOARD_USERNAME = 'operator';
  process.env.DASHBOARD_PASSWORD = 'safe-dashboard-password';
  process.env.JWT_SECRET = 'safe-jwt-secret';
  process.env.DASHBOARD_BCRYPT_ROUNDS = '10';

  try {
    assert.throws(
      () => loadSecurityConfig(),
      /DASHBOARD_BCRYPT_ROUNDS must be an integer greater than or equal to 12/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('isApiKeyMatch only accepts exact single-string matches', () => {
  assert.equal(isApiKeyMatch('safe-api-key-for-tests', 'safe-api-key-for-tests'), true);
  assert.equal(isApiKeyMatch('wrong-api-key-for-tests', 'safe-api-key-for-tests'), false);
  assert.equal(isApiKeyMatch(['safe-api-key-for-tests'], 'safe-api-key-for-tests'), false);
});

test('shouldReconnectAfterDisconnect skips intentional lifecycle disconnects', () => {
  assert.equal(shouldReconnectAfterDisconnect('NAVIGATION', false, false), true);
  assert.equal(shouldReconnectAfterDisconnect('LOGOUT', false, false), false);
  assert.equal(shouldReconnectAfterDisconnect('NAVIGATION', true, false), false);
  assert.equal(shouldReconnectAfterDisconnect('NAVIGATION', false, true), false);
});

test('getMessageResponseHttpStatus maps expected send failures', () => {
  assert.equal(getMessageResponseHttpStatus({ success: true, status: 'sent', message: 'ok' }), 200);
  assert.equal(getMessageResponseHttpStatus({ success: false, status: 'invalid_number', message: 'bad' }), 400);
  assert.equal(getMessageResponseHttpStatus({ success: false, status: 'rate_limited', message: 'limit' }), 429);
  assert.equal(getMessageResponseHttpStatus({ success: false, status: 'disconnected', message: 'offline' }), 503);
  assert.equal(getMessageResponseHttpStatus({ success: false, status: 'error', message: 'failed' }), 500);
});

test('getMessageResponsesHttpStatus maps aggregate send failures', () => {
  assert.equal(getMessageResponsesHttpStatus([
    { success: true, status: 'sent', message: 'ok' },
    { success: true, status: 'sent', message: 'ok' },
  ]), 200);
  assert.equal(getMessageResponsesHttpStatus([
    { success: false, status: 'disconnected', message: 'offline' },
    { success: false, status: 'disconnected', message: 'offline' },
  ]), 503);
  assert.equal(getMessageResponsesHttpStatus([
    { success: false, status: 'rate_limited', message: 'limit' },
    { success: false, status: 'rate_limited', message: 'limit' },
  ]), 429);
  assert.equal(getMessageResponsesHttpStatus([
    { success: true, status: 'sent', message: 'ok' },
    { success: false, status: 'disconnected', message: 'offline' },
  ]), 207);
  assert.equal(getMessageResponsesHttpStatus([
    { success: false, status: 'disconnected', message: 'offline' },
    { success: false, status: 'rate_limited', message: 'limit' },
  ]), 207);
});
