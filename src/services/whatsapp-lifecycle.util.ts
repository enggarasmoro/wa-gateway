export function shouldReconnectAfterDisconnect(
  reason: string,
  isLoggingOut: boolean,
  isShuttingDown: boolean
): boolean {
  return !isLoggingOut && !isShuttingDown && reason !== 'LOGOUT';
}
