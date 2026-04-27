export type LogLevel = 'info' | 'warn' | 'error';
export type OperationOutcome = 'success' | 'failure';

export interface OperationContext {
  correlationId: string;
  operation: string;
  startedAt: number;
}

type LogMeta = Record<string, unknown>;

function cleanMeta(meta: LogMeta = {}): LogMeta {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined)
  );
}

export function log(level: LogLevel, operation: string, message: string, meta: LogMeta = {}): void {
  const payload = {
    level,
    timestamp: new Date().toISOString(),
    operation,
    message,
    ...cleanMeta(meta),
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function createOperationContext(operation: string, correlationId: string): OperationContext {
  return {
    correlationId,
    operation,
    startedAt: Date.now(),
  };
}

export function logOperationStart(context: OperationContext, meta: LogMeta = {}): void {
  log('info', context.operation, 'operation_started', {
    correlationId: context.correlationId,
    ...meta,
  });
}

export function logOperationFinish(
  context: OperationContext,
  outcome: OperationOutcome,
  meta: LogMeta = {}
): void {
  const durationMs = Date.now() - context.startedAt;
  log(outcome === 'success' ? 'info' : 'error', context.operation, 'operation_finished', {
    correlationId: context.correlationId,
    outcome,
    durationMs,
    ...meta,
  });
}
