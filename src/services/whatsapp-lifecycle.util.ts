export function shouldReconnectAfterDisconnect(
  reason: string,
  isLoggingOut: boolean,
  isShuttingDown: boolean
): boolean {
  return !isLoggingOut && !isShuttingDown && reason !== 'LOGOUT';
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

export function isTransientWhatsAppInjectionError(error: unknown): boolean {
  const message = getErrorMessage(error);

  return [
    'Execution context was destroyed',
    'Runtime.callFunctionOn timed out',
    'auth timeout',
    // WhatsApp Web internal API not available — page JS context is uninitialized or corrupt
    'Cannot read properties of undefined',
    // Puppeteer page/browser/frame closed before call resolved — client is dead, must reconnect
    'Target closed',
    'Session closed',
    // V8 garbage-collected the pending Runtime.callFunctionOn callback (frame detached)
    'Promise was collected',
    // Generic CDP protocol failures — treat as transient and reconnect
    'Protocol error',
  ].some((needle) => message.includes(needle));
}

export function shouldRecoverFromState(state: string | null | undefined): boolean {
  if (!state) {
    return false;
  }

  return [
    'CONFLICT',
    'DEPRECATED',
    'DISCONNECTED',
    'PROXYBLOCK',
    'SMB_TOS_BLOCK',
    'TIMEOUT',
    'TOS_BLOCK',
    'UNLAUNCHED',
  ].includes(state);
}

export function shouldRecoverFromReadinessError(
  error: unknown,
  currentState: string,
  qrDisplayed: boolean,
  hadCachedReady: boolean
): boolean {
  if (!isTransientWhatsAppInjectionError(error)) {
    return false;
  }

  if (hadCachedReady) {
    return true;
  }

  if (qrDisplayed) {
    return false;
  }

  return !['WAITING_FOR_QR_SCAN', 'AUTHENTICATED', 'INITIALIZING'].includes(currentState);
}
