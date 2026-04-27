import { parseTargets, PhoneNumberValidationError } from './phone.util';

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export interface ValidatedSendRequest {
  target: string;
  targets: string[];
  message: string;
}

export interface ValidatedBroadcastRequest {
  targets: string[];
  message: string;
}

export interface ValidatedLoginRequest {
  username: string;
  password: string;
}

const MAX_MESSAGE_LENGTH = parseInt(process.env.MAX_MESSAGE_LENGTH || '4096', 10);
const MAX_BROADCAST_TARGETS = parseInt(process.env.MAX_BROADCAST_TARGETS || '100', 10);
const MAX_USERNAME_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 512;

function readStringField(body: unknown, field: string): string {
  if (!body || typeof body !== 'object' || !(field in body)) {
    throw new RequestValidationError(`Missing required field: ${field}`);
  }

  const value = (body as Record<string, unknown>)[field];

  if (typeof value !== 'string') {
    throw new RequestValidationError(`${field} must be a string`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new RequestValidationError(`${field} must not be empty`);
  }

  return trimmed;
}

function validateMessage(body: unknown): string {
  const message = readStringField(body, 'message');

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new RequestValidationError(`message must not exceed ${MAX_MESSAGE_LENGTH} characters`);
  }

  return message;
}

function assertTargetLimit(targets: string[]): void {
  if (targets.length > MAX_BROADCAST_TARGETS) {
    throw new RequestValidationError(`targets must not exceed ${MAX_BROADCAST_TARGETS} recipients`);
  }
}

function parseRequestTargets(targets: string): string[] {
  try {
    return parseTargets(targets);
  } catch (error) {
    if (error instanceof PhoneNumberValidationError) {
      throw new RequestValidationError(error.message);
    }

    throw error;
  }
}

export function validateSendRequest(body: unknown): ValidatedSendRequest {
  const target = readStringField(body, 'target');
  const message = validateMessage(body);
  const targets = parseRequestTargets(target);
  assertTargetLimit(targets);

  return { target, targets, message };
}

export function validateBroadcastRequest(body: unknown): ValidatedBroadcastRequest {
  if (!body || typeof body !== 'object' || !('targets' in body)) {
    throw new RequestValidationError('Missing required field: targets');
  }

  const rawTargets = (body as Record<string, unknown>).targets;
  const message = validateMessage(body);
  let targets: string[];

  if (Array.isArray(rawTargets)) {
    if (rawTargets.length === 0) {
      throw new RequestValidationError('targets must not be empty');
    }

    targets = rawTargets.map((target, index) => {
      if (typeof target !== 'string' || !target.trim()) {
        throw new RequestValidationError(`targets[${index}] must be a non-empty string`);
      }

      return parseRequestTargets(target).join(',');
    });
  } else if (typeof rawTargets === 'string') {
    targets = parseRequestTargets(rawTargets);
  } else {
    throw new RequestValidationError('targets must be an array of strings or comma-separated string');
  }

  const flattenedTargets = parseRequestTargets(targets.join(','));
  assertTargetLimit(flattenedTargets);

  return { targets: flattenedTargets, message };
}

export function validateLoginRequest(body: unknown): ValidatedLoginRequest {
  const username = readStringField(body, 'username');
  const password = readStringField(body, 'password');

  if (username.length > MAX_USERNAME_LENGTH) {
    throw new RequestValidationError(`username must not exceed ${MAX_USERNAME_LENGTH} characters`);
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RequestValidationError(`password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
  }

  return { username, password };
}
