import { handleFormWebhook } from '@/lib/forms/submission';

/**
 * POST /api/webhooks/onboarding-form
 *
 * Called by the Google Apps Script attached to each onboarding form's response
 * Sheet (see scripts/google-apps-script/onboarding-form-webhook.gs).
 *
 * Requires the X-Webhook-Secret header to match FORM_WEBHOOK_SECRET; if that env
 * var is unset the endpoint refuses everything (503). Matches the submission to
 * an Employee by e-code and sets SUBMITTED, or parks it in the unmatched list.
 */
export const POST = handleFormWebhook;
