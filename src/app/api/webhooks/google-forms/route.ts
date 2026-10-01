import { handleFormWebhook } from '@/lib/forms/submission';

/**
 * Legacy alias of /api/webhooks/onboarding-form so existing senders keep
 * working. Same secret check, same behaviour — it used to accept requests with
 * no authentication at all.
 */
export const POST = handleFormWebhook;
