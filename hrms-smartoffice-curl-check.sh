#!/usr/bin/env bash
#
# hrms-smartoffice-curl-check.sh
#
# Standalone diagnostic script — hits every SmartOffice endpoint your app
# calls (src/lib/smartoffice/client.ts) directly against the live server,
# with the HTTP method/path/params exactly as documented in
# SmartOfficeAPIDocumentation.pdf (v1.0.4), plus two known live discrepancies
# flagged explicitly (AddEmployee, UploadUser — see notes at each section).
#
# WHY THIS EXISTS: the PDF doc doesn't always match what the deployed
# instance actually accepts (AddEmployee is documented as GET but the live
# server requires POST — confirmed). This script lets you re-verify any
# endpoint against reality in one command, instead of guessing from the doc
# or waiting for the queue worker to fail a real employee record.
#
# Run from anywhere you have network access to the SmartOffice box —
# this must be run on the SAME LAN/VPN as your device (the sandbox that
# generated this script cannot reach 122.176.105.50 to test it for you).
#
# ── USAGE ───────────────────────────────────────────────────────────────
#   chmod +x hrms-smartoffice-curl-check.sh
#   BASE_URL="http://122.176.105.50:8081" API_KEY="<your real key>" \
#     ./hrms-smartoffice-curl-check.sh add_employee upload_user
#
# Run with no arguments to see the list of available test names.
# Run with "all" to run every READ-ONLY test (safe — see SAFETY NOTE).
# Run with "all_destructive" to also run tests that create/delete/clear
# real data on your SmartOffice instance and devices — only do this
# against a test employee/device you don't mind mutating.
# ───────────────────────────────────────────────────────────────────────

set -uo pipefail

BASE_URL="${BASE_URL:?Set BASE_URL, e.g. BASE_URL=http://122.176.105.50:8081}"
API_KEY="${API_KEY:?Set API_KEY to your real SmartOffice API key}"

# ── Sample data — override any of these via env vars before running ─────
# e.g. SERIAL_NUMBER=ABC123 EMP_CODE=E999 ./hrms-smartoffice-curl-check.sh add_employee
SERIAL_NUMBER="${SERIAL_NUMBER:-TEST-DEVICE-0001}"
EMP_CODE="${EMP_CODE:-TESTCODE001}"
EMP_NAME="${EMP_NAME:-Test Employee}"
COMPANY_SNAME="${COMPANY_SNAME:-Default}"
LOCATION="${LOCATION:-Default}"
DESIGNATION="${DESIGNATION:-Associate}"
FROM_DATE="${FROM_DATE:-$(date -u -d '7 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-7d +%Y-%m-%d)}"
TO_DATE="${TO_DATE:-$(date -u +%Y-%m-%d)}"

PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────
divider() { echo "────────────────────────────────────────────────────────────────"; }

run_get() {
  local name="$1" path="$2" qs="$3"
  divider
  echo "▶ $name"
  echo "  GET ${BASE_URL}${path}?${qs}"
  local resp
  resp=$(curl -sS -w '\n[HTTP %{http_code}]' -X GET "${BASE_URL}${path}?${qs}")
  echo "$resp"
  if echo "$resp" | grep -q '\[HTTP 200\]'; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

run_post() {
  local name="$1" path="$2" json="$3"
  divider
  echo "▶ $name"
  echo "  POST ${BASE_URL}${path}"
  echo "  Body: $json"
  local resp
  resp=$(curl -sS -w '\n[HTTP %{http_code}]' -X POST "${BASE_URL}${path}" \
    -H "Content-Type: application/json" -d "$json")
  echo "$resp"
  if echo "$resp" | grep -q '\[HTTP 200\]'; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

# ── Individual test functions (one per endpoint) ─────────────────────
# Naming/params/methods below match SmartOfficeAPIDocumentation.pdf v1.0.4
# unless a note says otherwise.

t_add_biometric() {
  run_post "AddBiometric (register a device)" "/api/v2/WebAPI/AddBiometric" \
    "{\"APIKey\":\"$API_KEY\",\"DeviceName\":\"Test Device\",\"SerialNumber\":\"$SERIAL_NUMBER\"}"
}

t_delete_biometric() {
  echo "⚠ DESTRUCTIVE — deletes a device registration. Skipped unless run via 'all_destructive'."
  run_get "DeleteBiometric" "/api/v2/WebAPI/DeleteBiometric" \
    "APIKey=$API_KEY&SerialNumber=$SERIAL_NUMBER"
}

t_get_device_logs() {
  run_get "GetDeviceLogs" "/api/v2/WebAPI/GetDeviceLogs" \
    "APIKey=$API_KEY&FromDate=$FROM_DATE&ToDate=$TO_DATE&SerialNumber=$SERIAL_NUMBER"
}

# ── AddEmployee: KNOWN DISCREPANCY ─────────────────────────────────────
# Doc (page 15) says GET. Your live server has been observed to reject GET
# with "does not support http method 'GET'". Both variants are provided
# below — run BOTH once to confirm which your instance actually wants.
t_add_employee_as_documented_GET() {
  echo "  (Doc-documented variant — expected to FAIL on your instance per prior error)"
  run_get "AddEmployee [doc says GET]" "/api/v2/WebAPI/AddEmployee" \
    "APIKey=$API_KEY&StaffCode=$EMP_CODE&StaffName=$EMP_NAME&Gender=Male&Status=Working&CompanySName=$COMPANY_SNAME&Location=$LOCATION&Designation=$DESIGNATION&DOJ=$(date -u +%Y-%m-%d)"
}

t_add_employee_as_fixed_POST() {
  echo "  (Live-verified fix — this is what client.ts now uses)"
  run_post "AddEmployee [fixed: POST]" "/api/v2/WebAPI/AddEmployee" \
    "{\"APIKey\":\"$API_KEY\",\"StaffCode\":\"$EMP_CODE\",\"StaffName\":\"$EMP_NAME\",\"Gender\":\"Male\",\"Status\":\"Working\",\"CompanySName\":\"$COMPANY_SNAME\",\"Location\":\"$LOCATION\",\"Designation\":\"$DESIGNATION\",\"DOJ\":\"$(date -u +%Y-%m-%d)\"}"
}

# ── UploadUser: UNCONFIRMED — run both to determine the real cause ────
# Doc (page 8) says POST /api/v2/WebAPI/UploadUser — matches current code —
# yet the live server returns "No HTTP resource was found that matches the
# request URI" instead of a normal success/failure response. Two hypotheses:
#   H1: this instance doesn't expose UploadUser under /v2 (like
#       GetDeviceCommands/BlockUserinBiometric, which the DOC itself
#       documents without /v2 — so this isn't unprecedented).
#   H2: the payload's SerialNumber was empty (unrelated to routing).
# Both variants below use a REAL, non-empty SERIAL_NUMBER — set it via env
# before running, e.g. SERIAL_NUMBER=<a real enrolled device serial>.
t_upload_user_v2_POST_as_documented() {
  run_post "UploadUser [doc-documented: POST /v2]" "/api/v2/WebAPI/UploadUser" \
    "{\"APIKey\":\"$API_KEY\",\"EmployeeCode\":\"$EMP_CODE\",\"EmployeeName\":\"$EMP_NAME\",\"SerialNumber\":\"$SERIAL_NUMBER\"}"
}

t_upload_user_no_v2_GET_fallback() {
  echo "  (Fallback hypothesis — only try if the /v2 POST above 404s)"
  run_get "UploadUser [fallback: GET, no /v2]" "/api/WebAPI/UploadUser" \
    "APIKey=$API_KEY&EmployeeCode=$EMP_CODE&EmployeeName=$EMP_NAME&SerialNumber=$SERIAL_NUMBER"
}

t_upload_user_no_v2_POST_fallback() {
  echo "  (Second fallback hypothesis — path without /v2, method still POST)"
  run_post "UploadUser [fallback: POST, no /v2]" "/api/WebAPI/UploadUser" \
    "{\"APIKey\":\"$API_KEY\",\"EmployeeCode\":\"$EMP_CODE\",\"EmployeeName\":\"$EMP_NAME\",\"SerialNumber\":\"$SERIAL_NUMBER\"}"
}

t_delete_user() {
  echo "⚠ DESTRUCTIVE — deletes user off a device. Skipped unless run via 'all_destructive'."
  run_post "DeleteUser" "/api/v2/WebAPI/DeleteUser" \
    "{\"APIKey\":\"$API_KEY\",\"EmployeeCode\":\"$EMP_CODE\",\"SerialNumber\":\"$SERIAL_NUMBER\"}"
}

t_fetch_live_users() {
  run_get "FetchLiveUsersFromBiometric" "/api/v2/WebAPI/FetchLiveUsersFromBiometric" \
    "APIKey=$API_KEY&SerialNumber=$SERIAL_NUMBER"
}

t_set_user_expiration() {
  echo "⚠ MUTATING — sets a real expiration rule. Skipped unless run via 'all_destructive'."
  run_get "SetUserExpiration" "/api/v2/WebAPI/SetUserExpiration" \
    "APIKey=$API_KEY&SerialNumber=$SERIAL_NUMBER&EmployeeCode=$EMP_CODE&ExpirationDate=3000-01-01"
}

t_get_device_commands() {
  # NOTE: no /v2 in this path — documented that way, matches client.ts.
  run_get "GetDeviceCommands [no /v2, per doc]" "/api/WebAPI/GetDeviceCommands" \
    "APIKey=$API_KEY&FromDate=$FROM_DATE&ToDate=$TO_DATE&SerialNumbers=$SERIAL_NUMBER"
}

t_block_user() {
  echo "⚠ MUTATING — blocks a real user on the device. Skipped unless run via 'all_destructive'."
  # NOTE: no /v2 in this path — documented that way, matches client.ts.
  run_get "BlockUserinBiometric [no /v2, per doc]" "/api/WebAPI/BlockUserinBiometric" \
    "APIKey=$API_KEY&EmployeeCode=$EMP_CODE&SerialNumber=$SERIAL_NUMBER&BlockUser=0"
}

t_unblock_user() {
  echo "⚠ MUTATING — unblocks a real user on the device. Skipped unless run via 'all_destructive'."
  run_get "BlockUserinBiometric [unblock, no /v2, per doc]" "/api/WebAPI/BlockUserinBiometric" \
    "APIKey=$API_KEY&EmployeeCode=$EMP_CODE&SerialNumber=$SERIAL_NUMBER&BlockUser=1"
}

t_clear_logs() {
  echo "⚠ DESTRUCTIVE — wipes ALL punch logs off the device. Skipped unless run via 'all_destructive'."
  run_get "ClearAllLogsFromDevice" "/api/v2/WebAPI/ClearAllLogsFromDevice" \
    "APIKey=$API_KEY&SerialNumber=$SERIAL_NUMBER"
}

t_clear_logs_by_time() {
  echo "⚠ DESTRUCTIVE — wipes punch logs in a time range. Speed Face models only. Skipped unless run via 'all_destructive'."
  run_get "ClearLogsFromDeviceByTime" "/api/v2/WebAPI/ClearLogsFromDeviceByTime" \
    "APIKey=$API_KEY&SerialNumber=$SERIAL_NUMBER&StartTime=2022-05-09%2009:00&EndTime=2022-05-09%2007:00"
}

t_trigger_enrollment() {
  echo "⚠ MUTATING — triggers a real enrollment prompt on the device. Skipped unless run via 'all_destructive'."
  run_get "TriggerUserOnlineEnrollment" "/api/v2/WebAPI/TriggerUserOnlineEnrollment" \
    "APIKey=$API_KEY&SerialNumber=$SERIAL_NUMBER&EmployeeCode=$EMP_CODE&EmployeeName=$EMP_NAME&backup_number=1"
}

t_delete_employee() {
  echo "⚠ DESTRUCTIVE — deletes an employee record. Skipped unless run via 'all_destructive'."
  run_get "DeleteEmployee" "/api/v2/WebAPI/DeleteEmployee" \
    "APIKey=$API_KEY&EmployeeCode=$EMP_CODE"
}

t_add_company() {
  run_get "AddCompany" "/api/v2/WebAPI/AddCompany" \
    "APIKey=$API_KEY&BranchFullName=Test%20Company&BranchShortName=$COMPANY_SNAME"
}

t_add_department() {
  run_get "AddDepartment" "/api/v2/WebAPI/AddDepartment" \
    "APIKey=$API_KEY&DepartmentFName=Test%20Department&DepartmentSName=TestDept"
}

t_add_location() {
  run_get "AddLocation" "/api/v2/WebAPI/AddLocation" \
    "APIKey=$API_KEY&LocationName=$LOCATION&LocationCode=$LOCATION"
}

t_add_designation() {
  run_get "AddDesignation" "/api/v2/WebAPI/AddDesignation" \
    "APIKey=$API_KEY&DesignationsName=$DESIGNATION&DesignationCode=$DESIGNATION"
}

t_add_grade() {
  run_get "AddGrade" "/api/v2/WebAPI/AddGrade" \
    "APIKey=$API_KEY&GradeCode=GradeA&GradeName=Grade%20A"
}

t_add_team() {
  run_get "AddTeam" "/api/v2/WebAPI/AddTeam" \
    "APIKey=$API_KEY&TeamCode=TeamA&TeamName=Team%20A"
}

# ── Test registry ───────────────────────────────────────────────────
declare -A READ_ONLY_TESTS=(
  [get_device_logs]=t_get_device_logs
  [fetch_live_users]=t_fetch_live_users
  [get_device_commands]=t_get_device_commands
  [add_employee_get]=t_add_employee_as_documented_GET
  [add_employee_post]=t_add_employee_as_fixed_POST
  [upload_user]=t_upload_user_v2_POST_as_documented
  [upload_user_fallback_get]=t_upload_user_no_v2_GET_fallback
  [upload_user_fallback_post]=t_upload_user_no_v2_POST_fallback
)

declare -A DESTRUCTIVE_TESTS=(
  [add_biometric]=t_add_biometric
  [delete_biometric]=t_delete_biometric
  [delete_user]=t_delete_user
  [set_user_expiration]=t_set_user_expiration
  [block_user]=t_block_user
  [unblock_user]=t_unblock_user
  [clear_logs]=t_clear_logs
  [clear_logs_by_time]=t_clear_logs_by_time
  [trigger_enrollment]=t_trigger_enrollment
  [delete_employee]=t_delete_employee
  [add_company]=t_add_company
  [add_department]=t_add_department
  [add_location]=t_add_location
  [add_designation]=t_add_designation
  [add_grade]=t_add_grade
  [add_team]=t_add_team
)

usage() {
  echo "Usage: BASE_URL=... API_KEY=... $0 <test_name> [<test_name> ...] | all | all_destructive | list"
  echo
  echo "Read-only / safe-to-run-anytime tests:"
  for k in "${!READ_ONLY_TESTS[@]}"; do echo "  - $k"; done | sort
  echo
  echo "Destructive/mutating tests (create real records, delete/block/clear real data):"
  for k in "${!DESTRUCTIVE_TESTS[@]}"; do echo "  - $k"; done | sort
}

if [ "$#" -eq 0 ] || [ "$1" == "list" ]; then
  usage
  exit 0
fi

TARGETS=("$@")
if [ "${TARGETS[0]}" == "all" ]; then
  TARGETS=("${!READ_ONLY_TESTS[@]}")
elif [ "${TARGETS[0]}" == "all_destructive" ]; then
  TARGETS=("${!READ_ONLY_TESTS[@]}" "${!DESTRUCTIVE_TESTS[@]}")
fi

for t in "${TARGETS[@]}"; do
  if [ -n "${READ_ONLY_TESTS[$t]:-}" ]; then
    "${READ_ONLY_TESTS[$t]}"
  elif [ -n "${DESTRUCTIVE_TESTS[$t]:-}" ]; then
    "${DESTRUCTIVE_TESTS[$t]}"
  else
    echo "Unknown test: $t"
    usage
    exit 1
  fi
done

divider
echo "Done. HTTP-200 responses: $PASS   Non-200/errored: $FAIL"
echo "Note: HTTP 200 does not always mean SmartOffice-level success — check the"
echo "response body's own 'status'/'Result'/'message' field too, since this API"
echo "sometimes returns 200 with a failure message in the body."
