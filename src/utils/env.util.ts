export function readIntegerEnv(
  name: string,
  defaultValue: number,
  options: { min?: number; max?: number } = {}
): number {
  const rawValue = process.env[name]?.trim();
  const value = rawValue === undefined || rawValue === ''
    ? defaultValue
    : Number(rawValue);

  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be greater than or equal to ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new Error(`${name} must be less than or equal to ${options.max}`);
  }

  return value;
}

export function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();

  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }

  if (['1', 'true', 'yes', 'on'].includes(rawValue)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(rawValue)) {
    return false;
  }

  throw new Error(`${name} must be a boolean`);
}
