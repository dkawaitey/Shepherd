/**
 * WhatsApp now identifies people by **username** as well as by phone number, and
 * the two do not share a link shape: `wa.me/<username>` opens a chat with a
 * handle, while a number has to be dialled as digits. A number-shaped handle is
 * refused with "not a username", so a stored value is read as a handle first and
 * only falls back to a number.
 *
 * WhatsApp's username rules (2026): 3–35 characters, lowercase letters, numbers,
 * periods and underscores only, at least one letter, and no "www" or domain
 * endings such as .com / .net.
 *
 * Kept as plain, dependency-free functions so both the Convex backend
 * (validation) and the React client (links) can share one rule.
 */

const USERNAME_RE = /^[a-z0-9._]{3,35}$/;
const DOMAIN_END_RE = /\.(com|net|org|edu|gov|io|co)$/;

/** True when a value follows WhatsApp's username rules. */
export function isWhatsappUsername(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!USERNAME_RE.test(v)) return false;
  if (!/[a-z]/.test(v)) return false; // all digits is a number, not a handle
  if (v.includes("www")) return false;
  if (DOMAIN_END_RE.test(v)) return false;
  return true;
}

/** A value the WhatsApp button can open a chat with. */
export type ChatTarget = { value: string; label: string };

/** Split a stored value on the separators volunteers actually type. */
const partsOf = (value: string) =>
  value
    .split(/[/,;|\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * Read a stored WhatsApp value into chat targets.
 *
 * One value is usually one handle, but volunteers paste several, so the field is
 * split on the separators they use. Anything that reads as a username is kept
 * verbatim (lowercased); anything number-shaped is reduced to its digits.
 */
export function parseWhatsappTargets(value?: string | null): ChatTarget[] {
  if (!value) return [];
  const seen = new Set<string>();
  const targets: ChatTarget[] = [];
  for (const part of partsOf(value)) {
    if (isWhatsappUsername(part)) {
      const handle = part.toLowerCase();
      if (seen.has(handle)) continue;
      seen.add(handle);
      targets.push({ value: handle, label: `@${handle}` });
      continue;
    }
    const digits = part.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 20 || seen.has(digits)) continue;
    seen.add(digits);
    targets.push({
      value: digits,
      label: part.replace(/[()]/g, " ").replace(/\s+/g, " ").trim(),
    });
  }
  return targets;
}

/** `wa.me` URL for a username or number, optionally with a pre-filled message. */
export function whatsappHref(value: string, text?: string) {
  const url = `https://wa.me/${value}`;
  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

export type WhatsappCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validate a WhatsApp field and normalise it.
 *
 * A username is lowercased; a number is kept as written. Several values may be
 * kept together, separated by `/`, `,`, `;` or a newline.
 */
export function checkWhatsapp(value: string): WhatsappCheck {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: "" };
  const out: string[] = [];
  for (const part of partsOf(trimmed)) {
    if (isWhatsappUsername(part)) {
      out.push(part.toLowerCase());
      continue;
    }
    const digits = part.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 20) {
      return {
        ok: false,
        error: `"${part}" is not a WhatsApp username or number. A username is 3–35 lowercase letters, numbers, dots or underscores (e.g. kofi.mensah).`,
      };
    }
    out.push(part);
  }
  return { ok: true, value: out.join(" / ") };
}
