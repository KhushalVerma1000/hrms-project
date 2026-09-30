/**
 * WhatsApp helpers. Uses wa.me click-to-chat links: the sender's own WhatsApp
 * opens with the message pre-written and they press Send. No WhatsApp Business
 * API account or credentials are needed.
 */

/** Country code prepended to bare 10-digit numbers (India). Constant, not an env var, because this file is also used in the browser. */
export const DEFAULT_PHONE_COUNTRY_CODE = '91';

/**
 * Normalises a typed mobile number to digits with country code, or null if it
 * is not plausible. Accepts "98765 43210", "+91 98765-43210", "09876543210",
 * "919876543210". A bare 10-digit number gets DEFAULT_PHONE_COUNTRY_CODE.
 */
export function normalizeMobile(raw: string | null | undefined): string | null {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = DEFAULT_PHONE_COUNTRY_CODE + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/** "+91 98765 43210"-style display for a stored number. */
export function formatMobile(stored: string | null | undefined): string {
  if (!stored) return '';
  const cc = DEFAULT_PHONE_COUNTRY_CODE;
  return stored.startsWith(cc) && stored.length === cc.length + 10
    ? `+${cc} ${stored.slice(cc.length, cc.length + 5)} ${stored.slice(cc.length + 5)}`
    : `+${stored}`;
}

/** The default message sent with the onboarding form link. */
export function buildOnboardingFormMessage(p: {
  name: string;
  clientName?: string | null;
  formUrl: string;
}): string {
  const first = p.name.trim().split(/\s+/)[0] || 'there';
  const org = p.clientName ? ` at ${p.clientName}` : '';
  return (
    `Hello ${first}, welcome${org}! Please fill in your onboarding form using this link:\n\n` +
    `${p.formUrl}\n\nThank you.`
  );
}

/** https://wa.me link that opens a chat with `mobile` and the message ready to send. */
export function buildWhatsAppUrl(mobile: string, message: string): string {
  return `https://wa.me/${mobile}?text=${encodeURIComponent(message)}`;
}

/** Convenience: returns '' when there is no number or no form URL. */
export function whatsAppFormLink(p: {
  mobile: string | null | undefined;
  name: string;
  clientName?: string | null;
  formUrl: string;
}): string {
  if (!p.mobile || !p.formUrl) return '';
  return buildWhatsAppUrl(p.mobile, buildOnboardingFormMessage(p));
}
