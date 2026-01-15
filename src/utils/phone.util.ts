/**
 * Format phone number to WhatsApp format (with country code)
 * @param phoneNumber - Phone number to format
 * @param defaultCountryCode - Default country code (default: 62 for Indonesia)
 * @returns Formatted phone number
 */
export function formatPhoneNumber(
  phoneNumber: string,
  defaultCountryCode: string = '62'
): string {
  // Remove all non-numeric characters
  let cleaned = phoneNumber.replace(/[^0-9]/g, '');

  // Validate length
  if (cleaned.length < 10 || cleaned.length > 15) {
    console.warn(`Invalid phone number length: ${phoneNumber}`);
    return phoneNumber;
  }

  // Format to international format
  if (cleaned.startsWith('0')) {
    // Local format: 081234567890 -> 6281234567890
    cleaned = defaultCountryCode + cleaned.substring(1);
  } else if (!cleaned.startsWith(defaultCountryCode)) {
    // Add country code if not present
    cleaned = defaultCountryCode + cleaned;
  }

  return cleaned;
}

/**
 * Format phone number for WhatsApp JID
 * @param phoneNumber - Phone number
 * @returns WhatsApp JID format (e.g., 6281234567890@s.whatsapp.net)
 */
export function toWhatsAppJid(phoneNumber: string): string {
  const formatted = formatPhoneNumber(phoneNumber);
  return `${formatted}@s.whatsapp.net`;
}

/**
 * Parse multiple phone numbers from comma-separated string
 * @param targets - Comma-separated phone numbers
 * @returns Array of formatted phone numbers
 */
export function parseTargets(targets: string): string[] {
  return targets
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => formatPhoneNumber(t));
}
