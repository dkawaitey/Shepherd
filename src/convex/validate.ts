/**
 * Server-side input validation helpers.
 *
 * All validation runs inside Convex mutations — the frontend is never
 * trusted as the sole validation layer.
 */

/** Trim and validate a name field. Names must be 1–200 chars after trimming. */
export function validateName(value: string, fieldName = "Name"): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${fieldName} is required`);
  if (trimmed.length > 200)
    throw new Error(`${fieldName} must be 200 characters or fewer`);
  return trimmed;
}

/** Trim and validate a required text field with a max length. */
export function validateText(
  value: string,
  fieldName: string,
  maxLen = 5000,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${fieldName} is required`);
  if (trimmed.length > maxLen)
    throw new Error(`${fieldName} must be ${maxLen} characters or fewer`);
  return trimmed;
}

/** Trim and validate an optional text field with a max length. Returns undefined if empty. */
export function validateOptionalText(
  value: string | undefined | null,
  fieldName: string,
  maxLen = 5000,
): string | undefined {
  if (!value || value.trim().length === 0) return undefined;
  const trimmed = value.trim();
  if (trimmed.length > maxLen)
    throw new Error(`${fieldName} must be ${maxLen} characters or fewer`);
  return trimmed;
}

/** Validate an email address format (basic but effective). */
export function validateEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0) return "";
  // RFC 5322 simplified — covers 99.9% of real email addresses
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(trimmed)) throw new Error("Invalid email address format");
  if (trimmed.length > 254) throw new Error("Email address is too long");
  return trimmed;
}

/** Validate a phone number — allows digits, spaces, dashes, parens, plus. */
export function validatePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length === 0) return "";
  // Allow international format: +233 24 000 0000, 0240000000, (024) 000-0000
  const stripped = trimmed.replace(/[\s\-().]/g, "");
  if (!/^\+?\d{7,15}$/.test(stripped)) {
    throw new Error("Invalid phone number format");
  }
  return trimmed;
}

/** Validate that a value is one of the allowed enum values. */
export function validateEnum<T extends string>(
  value: T,
  allowed: readonly T[],
  fieldName: string,
): T {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return value;
}

/** Validate a date string (ISO format YYYY-MM-DD). */
export function validateDate(dateStr: string, fieldName = "Date"): string {
  const trimmed = dateStr.trim();
  if (trimmed.length === 0) throw new Error(`${fieldName} is required`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) throw new Error(`${fieldName} is not a valid date`);
  return trimmed;
}

/** Sanitize a string by collapsing multiple whitespace and trimming. */
export function sanitize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Validate post title — required, 1–500 chars. */
export function validatePostTitle(title: string): string {
  return validateText(title, "Title", 500);
}

/** Validate post/comment body — required, 1–10000 chars. */
export function validatePostBody(body: string): string {
  return validateText(body, "Content", 10000);
}

/** Validate comment body — required, 1–5000 chars. */
export function validateCommentBody(body: string): string {
  return validateText(body, "Comment", 5000);
}

/** Validate note content — required, 1–10000 chars. */
export function validateNoteContent(content: string): string {
  return validateText(content, "Note", 10000);
}

/** Validate prayer title — required, 1–200 chars. */
export function validatePrayerTitle(title: string): string {
  return validateText(title, "Prayer title", 200);
}

/** Validate prayer summary — required, 1–5000 chars. */
export function validatePrayerSummary(summary: string): string {
  return validateText(summary, "Prayer summary", 5000);
}
