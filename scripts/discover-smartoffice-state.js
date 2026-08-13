#!/usr/bin/env node
// CommonJS companion for environments where running TypeScript directly is difficult.
const fs = require('fs');

// Load .env into process.env (best-effort parser for KEY="value" lines)
try {
  const envText = fs.readFileSync('.env', 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[key] = val;
  }
} catch (e) {
  // ignore if no .env present
}

const BASE_URL = process.env.SMARTOFFICE_BASE_URL;
const API_KEY = process.env.SMARTOFFICE_API_KEY;

if (!BASE_URL || !API_KEY) {
  console.error('❌ SMARTOFFICE_BASE_URL and/or SMARTOFFICE_API_KEY not set in environment or .env file.');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const arg = args.find((a) => a.startsWith(`--${flag}=`));
    return arg ? arg.split('=').slice(1).join('=') : undefined;
  };
  return { from: get('from') || '2023-01-01', to: get('to') || new Date().toISOString().split('T')[0] };
}

async function smartGet(path, params) {
  const url = new URL(path, BASE_URL);
  url.searchParams.set('APIKey', API_KEY);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text.replace(/^"|"$/g, ''); }
}

async function main() {
  const { from, to } = parseArgs();
  console.log(`🔍 Discovering SmartOffice state from ${from} to ${to}...\n`);
  const devices = new Map();

  console.log('📡 Fetching device commands history...');
  try {
    const commandsResult = await smartGet('/api/WebAPI/GetDeviceCommands', { FromDate: from, ToDate: to });
    const records = commandsResult?.records || [];
    for (const rec of records) {
      const sn = rec.SerialNumber;
      if (!sn) continue;
      if (!devices.has(sn)) devices.set(sn, { serialNumber: sn, deviceCode: rec.DeviceCode, discoveredVia: [] });
      const dev = devices.get(sn);
      if (!dev.discoveredVia.includes('GetDeviceCommands')) dev.discoveredVia.push('GetDeviceCommands');
      if (!dev.deviceCode && rec.DeviceCode) dev.deviceCode = rec.DeviceCode;
    }
    console.log(`   Found ${devices.size} distinct device(s) via command history.`);
  } catch (err) { console.warn(`   ⚠️  GetDeviceCommands failed: ${err.message || err}`); }

  console.log('📡 Fetching attendance log history (for device discovery only)...');
  try {
    const logsResult = await smartGet('/api/v2/WebAPI/GetDeviceLogs', { FromDate: from, ToDate: to });
    const records = Array.isArray(logsResult) ? logsResult : [];
    let newFromLogs = 0;
    for (const rec of records) {
      const sn = rec.SerialNumber;
      if (!sn) continue;
      if (!devices.has(sn)) { devices.set(sn, { serialNumber: sn, discoveredVia: [] }); newFromLogs++; }
      const dev = devices.get(sn);
      if (!dev.discoveredVia.includes('GetDeviceLogs')) dev.discoveredVia.push('GetDeviceLogs');
    }
    console.log(`   Found ${newFromLogs} additional device(s) via punch logs (not in command history).`);
  } catch (err) { console.warn(`   ⚠️  GetDeviceLogs failed: ${err.message || err}`); }

  if (devices.size === 0) {
    console.error('\n❌ No devices discovered at all. This likely means:');
    console.error('   - The date range is wrong (try widening --from further back)');
    console.error('   - The API key/base URL are misconfigured (run the in-app "Test SmartOffice Connection" first)');
    console.error('   - There genuinely is no command/punch history in SmartOffice yet');
    process.exit(1);
  }

  console.log(`\n📡 Fetching live user list for ${devices.size} discovered device(s)...`);
  const allEmployeeCodesSeen = new Set();

  for (const device of devices.values()) {
    try {
      const liveResult = await smartGet('/api/v2/WebAPI/FetchLiveUsersFromBiometric', { SerialNumber: device.serialNumber });
      const users = Array.isArray(liveResult) ? liveResult : [];
      device.liveUsers = users.map((u) => ({ employeeCode: u.EmployeeCode, fpCount: u.FPCount, privilege: u.Privilege }));
      device.liveUsers.forEach((u) => allEmployeeCodesSeen.add(u.employeeCode));
      console.log(`   ${device.serialNumber} (${device.deviceCode || 'unnamed'}): ${device.liveUsers.length} live user(s)`);
    } catch (err) {
      device.liveUserFetchError = err.message || String(err);
      console.warn(`   ⚠️  ${device.serialNumber}: failed to fetch live users — ${device.liveUserFetchError}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const report = { generatedAt: new Date().toISOString(), dateRangeQueried: { from, to }, deviceCount: devices.size, totalLiveEmployeeCodesSeen: allEmployeeCodesSeen.size, devices: Array.from(devices.values()), allEmployeeCodesSeen: Array.from(allEmployeeCodesSeen).sort() };
  const outPath = './smartoffice-discovery-report.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n✅ Discovery complete.`);
  console.log(`   Devices found:           ${report.deviceCount}`);
  console.log(`   Distinct live employees:  ${report.totalLiveEmployeeCodesSeen}`);
  console.log(`   Full report written to:   ${outPath}`);
  console.log('\nNext steps:');
  console.log(`   1. Open ${outPath} and review the device list — match each DeviceCode/SerialNumber to the Store it's physically at.`);
  console.log('   2. Register each device via the app\'s Devices page (Admin), assigning it to the correct Store.');
  console.log('   3. Cross-check allEmployeeCodesSeen against your CSV export (RadGridExport-style) — any code that appears here but NOT in your CSV export needs manual investigation before import.');
}

main().catch((err) => { console.error('Discovery failed:', err); process.exit(1); });
