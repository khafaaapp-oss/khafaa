import { User } from '../models/User.js';

/**
 * Generates a unique 11-digit phone number.
 * Retries a few times in case of a collision.
 */
export async function generateUniquePhoneNumber(maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Always start with '7' to keep a consistent 11-digit local format.
    // Example: 7XXXXXXXXXX (11 digits total)
    const first = '7';
    const rest = Array.from({ length: 10 }, () =>
      Math.floor(Math.random() * 10)
    ).join('');
    const candidate = first + rest;

    const exists = await User.exists({ phoneNumber: candidate });
    if (!exists) return candidate;
  }

  throw new Error('Could not generate a unique phone number, try again');
}

/**
 * Validates that a string is exactly 11 digits.
 */
export function isValidPhoneNumber(value) {
  return typeof value === 'string' && /^\d{11}$/.test(value);
}
