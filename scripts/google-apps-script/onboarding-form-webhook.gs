/**
 * Tells the HRMS app when someone submits an onboarding Google Form.
 *
 * SAFE TO ADD NEXT TO YOUR EXISTING SCRIPTS (offer letters etc.):
 *  - Every name here starts with "hrms" / "HRMS_", so nothing clashes with your code.
 *  - It only READS the submitted answers. It never edits the Sheet or your other scripts.
 *  - It runs from its own trigger, so a failure here cannot stop your offer-letter
 *    script, and the other way round.
 *
 * SET UP (once per form):
 *  1. Open the form's response Sheet -> Extensions -> Apps Script.
 *  2. Do NOT replace your existing code. Click "+" next to Files -> Script, name it
 *     "hrms-webhook", and paste this whole file into that NEW file.
 *  3. Project Settings (gear) -> Script properties -> add two properties:
 *       HRMS_WEBHOOK_URL     https://YOUR-APP.vercel.app/api/webhooks/onboarding-form
 *       HRMS_WEBHOOK_SECRET  the same value as FORM_WEBHOOK_SECRET in the app's environment
 *  4. Triggers (clock icon) -> Add trigger, and leave your existing triggers alone:
 *       function: hrmsOnFormSubmit  |  event source: From spreadsheet  |  event type: On form submit
 *  5. Google will ask you to approve permissions again ("connect to an external service").
 *     Approve it. If a trigger of yours shows an authorization error afterwards, open the
 *     project, run any function once by hand and approve — that re-enables all triggers.
 *  6. Test: run hrmsTestWebhook once (checks URL + secret), then submit the form with a
 *     real e-code. The employee should leave "Pending Forms" in the app.
 *
 * ALREADY HAVE ONE onFormSubmit YOU WANT TO KEEP AS THE ONLY TRIGGER?
 *  Skip step 4 and call this from inside it instead:   hrmsNotifyApp_(e);
 *  Wrap it so an HRMS problem cannot break your offer letters:
 *      try { hrmsNotifyApp_(e); } catch (err) { console.error(err); }
 *
 * The form must have a question titled with "Employee Code" or "E-Code" (that is where
 * the app pre-fills the code). Other common titles are tolerated by the app, and anything
 * it cannot match goes to "Form Submissions" in the app for an admin to link.
 */

/** Trigger entry point. */
function hrmsOnFormSubmit(e) {
  hrmsNotifyApp_(e);
}

/** Sends one submission to the HRMS app. Throws if it could not be delivered. */
function hrmsNotifyApp_(e) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('HRMS_WEBHOOK_URL');
  var secret = props.getProperty('HRMS_WEBHOOK_SECRET');
  if (!url || !secret) {
    throw new Error('HRMS: set HRMS_WEBHOOK_URL and HRMS_WEBHOOK_SECRET in Project Settings -> Script properties.');
  }

  var answers = (e && e.namedValues) || {};
  var payload = {
    employeeCode: hrmsFindEmployeeCode_(answers),
    formId: hrmsGetFormId_(e),
    submittedAt: new Date().toISOString(),
    rawValues: answers, // lets an admin reconcile a submission the app could not match
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'X-Webhook-Secret': secret },
    muteHttpExceptions: true,
  };

  // Retry on server errors / timeouts so a brief outage does not lose a submission.
  var lastStatus = 0;
  for (var attempt = 1; attempt <= 4; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, options);
      lastStatus = res.getResponseCode();
      if (lastStatus >= 200 && lastStatus < 300) return;
      if (lastStatus >= 400 && lastStatus < 500) break; // wrong secret/URL: retrying will not help
    } catch (err) {
      lastStatus = -1;
    }
    Utilities.sleep(2000 * attempt);
  }
  // Shows in Apps Script "Executions" (and in failure notification emails if you enabled them).
  throw new Error('HRMS webhook failed, last HTTP status: ' + lastStatus);
}

/** Finds the answer to the e-code question, whatever the question is titled exactly. */
function hrmsFindEmployeeCode_(answers) {
  for (var title in answers) {
    if (/(employee|staff)\s*code|e[\s-]?code/i.test(title)) {
      var v = answers[title];
      var value = (Array.isArray(v) ? v[0] : v) || '';
      return String(value).replace(/\s+/g, '');
    }
  }
  return '';
}

/** The linked form's id, so unmatched submissions show which form they came from. */
function hrmsGetFormId_(e) {
  try {
    var formUrl = e.range.getSheet().getParent().getFormUrl();
    var m = formUrl && formUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : '';
  } catch (err) {
    return '';
  }
}

/**
 * Run this by hand once to check the URL and secret. It sends a fake code, so the app
 * will list it under "Form Submissions" as unmatched — just dismiss it there.
 */
function hrmsTestWebhook() {
  hrmsNotifyApp_({ namedValues: { 'Employee Code': ['0000000000'] } });
}
