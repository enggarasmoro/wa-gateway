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
  ].some((needle) => message.includes(needle));
}
