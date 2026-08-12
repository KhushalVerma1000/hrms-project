/**
 * Google Sheets polling fallback for onboarding form submission tracking.
 *
 * This is an ALTERNATIVE to the Apps Script webhook (Section 13.2 of the spec).
 * The webhook approach is preferred — use this only if Apps Script is unavailable
 * or execution quotas become a constraint at high submission volume.
 *
 * To enable:
 * 1. Create a Google Cloud service account with Google Sheets API read access
 * 2. Share the response Sheet with the service account email
 * 3. Set GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON and GOOGLE_SHEETS_SHEET_ID in .env.local
 * 4. Call pollGoogleSheetForNewSubmissions() from the worker process on a schedule
 *
 * This module has no runtime dependencies on any Google SDK by default.
 * Install '@googleapis/sheets' if you activate this path.
 */

export interface SheetRow {
  rowIndex: number;
  submittedAt: string;
  employeeCode: string;
  rawValues: Record<string, string>;
}

/**
 * Polls the linked Google Sheet for new form submissions not yet processed.
 *
 * @returns Array of new rows (not yet seen by this app)
 *
 * @note This function is not wired up by default — the Apps Script webhook
 * (src/app/api/webhooks/onboarding-form/route.ts) is the active integration.
 * To activate, install @googleapis/sheets and implement the API call below.
 */
export async function pollGoogleSheetForNewSubmissions(): Promise<SheetRow[]> {
  const serviceAccountJson = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID;

  if (!serviceAccountJson || !sheetId) {
    console.warn(
      '[FormPolling] GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON or GOOGLE_SHEETS_SHEET_ID not set. ' +
      'Sheets polling is disabled. Use the Apps Script webhook instead.',
    );
    return [];
  }

  // TODO: Implement Sheets API call using @googleapis/sheets
  // Example (not activated by default):
  // const auth = new google.auth.GoogleAuth({ ... });
  // const sheets = google.sheets({ version: 'v4', auth });
  // const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1' });
  // Diff against last seen row (store in DB as SyncState) and return new rows.

  console.warn('[FormPolling] Sheets polling stub called — not yet implemented.');
  return [];
}
