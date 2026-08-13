/**
 * SMARTOFFICE LIVE-STATE DISCOVERY SCRIPT
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST — an honest limitation, not a workaround for one:
 *
 * SmartOffice's REST API (per its own documentation) has NO "list all
 * devices" or "list all employees" endpoint. It only exposes Add/Delete for
 * those, plus a few endpoints that operate on an ALREADY-KNOWN serial number
 * (FetchLiveUsersFromBiometric, SetUserExpiration, etc.).
 *
 * This script does the best possible job within that real constraint:
 *
 *   1. Calls GetDeviceCommands over a wide date range (no SerialNumbers filter)
 *      to discover every device SerialNumber/DeviceCode that has EVER had a
 *      command issued against it.
 *   2. Calls GetDeviceLogs over the same range to catch any device that has
 *      punch history but somehow never had a command logged — belt and
 *      suspenders, unions both sets of discovered serial numbers.
 *   3. For each discovered SerialNumber, calls FetchLiveUsersFromBiometric to
 *      get that device's CURRENT live enrolled user list (EmployeeCode +
 *      fingerprint count + privilege level) — this is the closest thing to
 *      "current state" the API actually offers.
 *
 * WHAT THIS CANNOT GIVE YOU: employee names, branches, locations, or
 * designations — FetchLiveUsersFromBiometric only returns EmployeeCode. For
 * that, you still need a fresh grid export from SmartOffice's own web UI
 * (the same RadGridExport.xls-style export used by import-legacy-employees.ts).
 * This script's job is to tell you WHICH devices/employees currently exist
 * and are live on the hardware, so you can cross-check that against your
 * export and catch anything the export missed or that's since changed.
 *
 * Also: this cannot tell you which Store/Location a discovered device
 * physically sits at — DeviceCode is just a label SmartOffice assigns, not
 * guaranteed to encode location. Use the report's DeviceCode/device name to
 * manually assign each discovered device to the right Store via the app's
 * existing "Register Device" UI once you've reviewed this output.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USAGE:
 *   Requires SMARTOFFICE_BASE_URL and SMARTOFFICE_API_KEY in the environment.
 *   Standalone script — doesn't touch Postgres/Prisma at all, read-only against SmartOffice.
 *
 *   npx dotenv -e .env.local -- npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/discover-smartoffice-state.ts --from=2023-01-01 --to=2026-08-13
 *
 *   (install dotenv-cli once if you don't have it: npm install --save-dev dotenv-cli)
 *   Output is written to ./smartoffice-discovery-report.json
 */

import * as fs from 'fs';

const BASE_URL = process.env.SMARTOFFICE_BASE_URL;
const API_KEY = process.env.SMARTOFFICE_API_KEY;

if (!BASE_URL || !API_KEY) {
  console.error('❌ SMARTOFFICE_BASE_URL and/or SMARTOFFICE_API_KEY not set in environment.');
  console.error('   Run this with your .env loaded, e.g.: npx dotenv -e .env.local -- npx ts-node ...');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`--${flag}=`));
    return arg ? arg.split('=').slice(1).join('=') : undefined;
  };
  return {
    from: get('from') || '2023-01-01',
    to: get('to') || new Date().toISOString().split('T')[0],
  };
}

async function smartGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(path, BASE_URL);
  url.searchParams.set('APIKey', API_KEY!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Some SmartOffice endpoints return a bare quoted string, not JSON — normalize
    return text.replace(/^"|"$/g, '');
  }
}

interface DiscoveredDevice {
  serialNumber: string;
  deviceCode?: string;
  discoveredVia: string[];
  liveUsers?: { employeeCode: string; fpCount: string; privilege: string }[];
  liveUserFetchError?: string;
}

async function main() {
  const { from, to } = parseArgs();
  console.log(`🔍 Discovering SmartOffice state from ${from} to ${to}...\n`);

  const devices = new Map<string, DiscoveredDevice>();

  // ── Step 1: GetDeviceCommands (no SerialNumbers filter = all devices) ──────
  console.log('📡 Fetching device commands history...');
  try {
    const commandsResult = await smartGet('/api/v2/WebAPI/GetDeviceCommands', { FromDate: from, ToDate: to });
    const records = commandsResult?.records || [];
    for (const rec of records) {
      const sn = rec.SerialNumber;
      if (!sn) continue;
      if (!devices.has(sn)) {
        devices.set(sn, { serialNumber: sn, deviceCode: rec.DeviceCode, discoveredVia: [] });
      }
      const dev = devices.get(sn)!;
      if (!dev.discoveredVia.includes('GetDeviceCommands')) dev.discoveredVia.push('GetDeviceCommands');
      if (!dev.deviceCode && rec.DeviceCode) dev.deviceCode = rec.DeviceCode;
    }
    console.log(`   Found ${devices.size} distinct device(s) via command history.`);
  } catch (err: any) {
    console.warn(`   ⚠️  GetDeviceCommands failed: ${err.message}`);
  }

  // ── Step 2: GetDeviceLogs (catch devices with punches but no commands) ─────
  console.log('📡 Fetching attendance log history (for device discovery only)...');
  try {
    const logsResult = await smartGet('/api/v2/WebAPI/GetDeviceLogs', { FromDate: from, ToDate: to });
    const records = Array.isArray(logsResult) ? logsResult : [];
    let newFromLogs = 0;
    for (const rec of records) {
      const sn = rec.SerialNumber;
      if (!sn) continue;
      if (!devices.has(sn)) {
        devices.set(sn, { serialNumber: sn, discoveredVia: [] });
        newFromLogs++;
      }
      const dev = devices.get(sn)!;
      if (!dev.discoveredVia.includes('GetDeviceLogs')) dev.discoveredVia.push('GetDeviceLogs');
    }
    console.log(`   Found ${newFromLogs} additional device(s) via punch logs (not in command history).`);
  } catch (err: any) {
    console.warn(`   ⚠️  GetDeviceLogs failed: ${err.message}`);
  }

  if (devices.size === 0) {
    console.error('\n❌ No devices discovered at all. This likely means:');
    console.error('   - The date range is wrong (try widening --from further back)');
    console.error('   - The API key/base URL are misconfigured (run the in-app "Test SmartOffice Connection" first)');
    console.error('   - There genuinely is no command/punch history in SmartOffice yet');
    process.exit(1);
  }

  // ── Step 3: FetchLiveUsersFromBiometric per discovered device ──────────────
  console.log(`\n📡 Fetching live user list for ${devices.size} discovered device(s)...`);
  const allEmployeeCodesSeen = new Set<string>();

  for (const device of devices.values()) {
    try {
      const liveResult = await smartGet('/api/v2/WebAPI/FetchLiveUsersFromBiometric', {
        SerialNumber: device.serialNumber,
      });
      const users = Array.isArray(liveResult) ? liveResult : [];
      device.liveUsers = users.map((u: any) => ({
        employeeCode: u.EmployeeCode,
        fpCount: u.FPCount,
        privilege: u.Privilege,
      }));
      device.liveUsers.forEach((u) => allEmployeeCodesSeen.add(u.employeeCode));
      console.log(`   ${device.serialNumber} (${device.deviceCode || 'unnamed'}): ${device.liveUsers.length} live user(s)`);
    } catch (err: any) {
      device.liveUserFetchError = err.message;
      console.warn(`   ⚠️  ${device.serialNumber}: failed to fetch live users — ${err.message}`);
    }
    // Small delay between calls — be a polite citizen to a server that might be modest hardware
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    dateRangeQueried: { from, to },
    deviceCount: devices.size,
    totalLiveEmployeeCodesSeen: allEmployeeCodesSeen.size,
    devices: Array.from(devices.values()),
    allEmployeeCodesSeen: Array.from(allEmployeeCodesSeen).sort(),
  };

  const outPath = './smartoffice-discovery-report.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n✅ Discovery complete.`);
  console.log(`   Devices found:           ${report.deviceCount}`);
  console.log(`   Distinct live employees:  ${report.totalLiveEmployeeCodesSeen}`);
  console.log(`   Full report written to:   ${outPath}`);
  console.log(`\nNext steps:`);
  console.log(`   1. Open ${outPath} and review the device list — match each DeviceCode/SerialNumber to the Store it's physically at.`);
  console.log(`   2. Register each device via the app's Devices page (Admin), assigning it to the correct Store.`);
  console.log(`   3. Cross-check allEmployeeCodesSeen against your CSV export (RadGridExport-style) — any code`);
  console.log(`      that appears here but NOT in your CSV export needs manual investigation before import.`);
}

main().catch((err) => {
  console.error('Discovery failed:', err);
  process.exit(1);
});
