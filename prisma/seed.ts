import {
  PrismaClient, Role, Designation, OnboardingFormStatus,
  AttendanceMode, ManualAttendanceStatus,
} from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // ─── Counters ─────────────────────────────────────────────────────────────
  // Client/WarehouseType/Store codes now start at 10 (not 01) so the assembled
  // e-code never begins with a leading zero — see Client.code comment in schema.prisma.
  await prisma.counter.upsert({
    where: { id: 'client' },
    update: {},
    create: { id: 'client', value: 9 }, // next increment lands on 10
  });
  await prisma.counter.upsert({
    where: { id: 'warehouseType' },
    update: {},
    create: { id: 'warehouseType', value: 9 },
  });

  // ─── Admin User ───────────────────────────────────────────────────────────
  const adminPasswordHash = await bcrypt.hash('Admin@1234', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@codzen.in' },
    update: {},
    create: {
      email: 'admin@codzen.in',
      passwordHash: adminPasswordHash,
      name: 'Platform Admin',
      role: Role.ADMIN,
    },
  });
  console.log('✅ Admin user:', admin.email);

  // ─── Warehouse Types (global master list) ─────────────────────────────────
  const warehouseTypes = [
    { name: 'Amazon', code: '10' },
    { name: 'Blinkit', code: '11' },
    { name: 'Zepto', code: '12' },
  ];

  for (const wt of warehouseTypes) {
    await prisma.warehouseType.upsert({
      where: { name: wt.name },
      update: {},
      create: { code: wt.code, name: wt.name },
    });
  }
  // Sync counter to reflect seeded warehouse types (10, 11, 12 issued → next is 13)
  await prisma.counter.update({
    where: { id: 'warehouseType' },
    data: { value: 9 + warehouseTypes.length },
  });
  console.log('✅ Warehouse types seeded:', warehouseTypes.map((w) => w.name).join(', '));

  // ─── Demo Client: Mansa Maharani ──────────────────────────────────────────
  const client = await prisma.client.upsert({
    where: { code: '10' },
    update: {},
    create: {
      code: '10',
      name: 'Mansa Maharani',
      shortName: 'MM',
      email: 'ops@mansamaharani.in',
    },
  });
  await prisma.counter.update({
    where: { id: 'client' },
    data: { value: 10 },
  });
  console.log('✅ Demo client:', client.name);

  // Initialise per-client store counter — starts at 10 as well.
  await prisma.counter.upsert({
    where: { id: `storeCode:${client.id}` },
    update: {},
    create: { id: `storeCode:${client.id}`, value: 9 },
  });

  // ─── Demo Store: Saket (Amazon) ───────────────────────────────────────────
  const amazon = await prisma.warehouseType.findUnique({ where: { name: 'Amazon' } });
  if (!amazon) throw new Error('Amazon warehouse type not found after seeding');

  const store = await prisma.store.upsert({
    where: { clientId_code: { clientId: client.id, code: '10' } },
    update: {},
    create: {
      code: '10',
      name: 'Saket',
      externalStoreCode: 'DEL_SAK_01',
      clientId: client.id,
      warehouseTypeId: amazon.id,
      address: 'Saket, New Delhi, India',
      latitude: 28.5244,
      longitude: 77.2167,
      geofenceRadius: 200,
      // NOTE: left at 1 (the pre-fix value) deliberately — the 5 demo
      // employees seeded below are hardcoded fixtures using legacy-style
      // serials (...0001-...0005) to mirror real imported data, and the
      // counter is force-set to 6 right after anyway (see below). New
      // stores created through the live app get the corrected @default(100)
      // from schema.prisma instead — see src/lib/ecode.ts leading-zero audit.
      nextEmployeeSerial: 1,
      // Explicit (matches the default) — Saket is the biometric-store test
      // fixture: seeded AttendanceLog punches below let you exercise the
      // OT-reconciliation flow (spec §5.4) against a real device-mode store.
      attendanceMode: AttendanceMode.BIOMETRIC,
    },
  });
  await prisma.counter.update({
    where: { id: `storeCode:${client.id}` },
    data: { value: 10 },
  });
  console.log('✅ Demo store:', store.name);

  // ─── Client User (for Mansa Maharani) ────────────────────────────────────
  const clientPasswordHash = await bcrypt.hash('Client@1234', 12);
  const clientUser = await prisma.user.upsert({
    where: { email: 'client@mansaraharani.in' },
    update: {},
    create: {
      email: 'client@mansaraharani.in',
      passwordHash: clientPasswordHash,
      name: 'Mansa Maharani Ops',
      role: Role.CLIENT,
      clientId: client.id,
      mustChangePassword: true,
    },
  });
  console.log('✅ Client user:', clientUser.email);

  // ─── Demo Manager for Saket ───────────────────────────────────────────────
  const managerPasswordHash = await bcrypt.hash('Manager@1234', 12);
  const manager = await prisma.user.upsert({
    where: { email: 'manager.saket@mansaraharani.in' },
    update: {},
    create: {
      email: 'manager.saket@mansaraharani.in',
      passwordHash: managerPasswordHash,
      name: 'Saket Store Manager',
      role: Role.MANAGER,
      clientId: client.id,
      storeId: store.id,
      mustChangePassword: true,
    },
  });
  console.log('✅ Demo manager:', manager.email);

  // ─── Real stores + devices (from SmartOffice device export) ───────────
  // Sourced from the "Manage Devices" screenshots — Device Name = store
  // name, Location column matches (with one spelling quirk noted below).
  // Coordinates below are ROUGH locality-level geocodes, not the actual
  // store geofence — confirm/replace with real lat/lng before relying on
  // geofencing for these stores. externalStoreCode is left null since no
  // brand-side warehouse code was provided for these (unlike Saket's
  // fabricated DEL_SAK_01 demo value above).
  const zepto = await prisma.warehouseType.findUnique({ where: { name: 'Zepto' } });
  if (!zepto) throw new Error('Zepto warehouse type not found after seeding');

  const brandByName: Record<string, { id: string }> = {
    Amazon: amazon,
    Blinkit: (await prisma.warehouseType.findUnique({ where: { name: 'Blinkit' } }))!,
    Zepto: zepto,
  };

  interface RealStoreSeed {
    /// Matches AttendanceLog.employeeCode joins by store — also used to
    /// match rows in the employee CSV's Location column (see below).
    csvLocationKeys: string[];
    name: string;
    code: string;
    brand: 'Amazon' | 'Blinkit' | 'Zepto';
    serialNumber: string;
    latitude: number;
    longitude: number;
  }

  const REAL_STORES: RealStoreSeed[] = [
    // Saket already exists (code 10, seeded above) — device attached below.
    { csvLocationKeys: ['punjabi bagh'], name: 'Punjabi Bagh', code: '11', brand: 'Amazon', serialNumber: 'AMDB24122800799', latitude: 28.6692, longitude: 77.1174 },
    { csvLocationKeys: ['burari'], name: 'Burari', code: '12', brand: 'Amazon', serialNumber: 'AMDB24122800354', latitude: 28.7500, longitude: 77.2010 },
    { csvLocationKeys: ['khizrabad'], name: 'Khizrabad', code: '13', brand: 'Amazon', serialNumber: 'AMDB24122800681', latitude: 28.5891, longitude: 77.2405 },
    { csvLocationKeys: ['faridabad sec-37'], name: 'Faridabad Sec-37', code: '14', brand: 'Blinkit', serialNumber: 'C2642CA8672A1C25', latitude: 28.4089, longitude: 77.3178 },
    { csvLocationKeys: ['faridabad sec-16'], name: 'Faridabad Sec-16', code: '15', brand: 'Blinkit', serialNumber: 'AMDB24111500381', latitude: 28.3894, longitude: 77.3040 },
    // Device Name = "Trilokpuri" but the CSV's Location column spells it
    // "tirlokpuri" (transposed letters) — mapped explicitly since it won't
    // match on normal normalization.
    { csvLocationKeys: ['tirlokpuri', 'trilokpuri'], name: 'Trilokpuri', code: '16', brand: 'Blinkit', serialNumber: 'AMDB25062800713', latitude: 28.6023, longitude: 77.3152 },
    { csvLocationKeys: ['jahangirpuri'], name: 'Jahangirpuri', code: '17', brand: 'Amazon', serialNumber: 'AMDB24111500045', latitude: 28.7286, longitude: 77.1637 },
    // CSV has this as "Faridabad sec -2" (space before the hyphen) —
    // normalization below strips spaces/hyphens so it still matches.
    { csvLocationKeys: ['faridabad sec-2', 'faridabad sec -2'], name: 'Faridabad Sec-2', code: '18', brand: 'Zepto', serialNumber: 'AMDB24111500047', latitude: 28.3894, longitude: 77.3910 },
    { csvLocationKeys: ['malviya nagar', 'malviya'], name: 'Malviya Nagar', code: '19', brand: 'Amazon', serialNumber: 'DF68C0611F0E3836', latitude: 28.5307, longitude: 77.2100 },
    { csvLocationKeys: ['faridabad sec-86'], name: 'Faridabad Sec-86', code: '20', brand: 'Amazon', serialNumber: 'AMDB24111500062', latitude: 28.4432, longitude: 77.3245 },
  ];

  // Saket's own device, attached to the store already created above.
  await prisma.device.upsert({
    where: { serialNumber: 'AMDB24122800519' },
    update: { storeId: store.id },
    create: { serialNumber: 'AMDB24122800519', name: 'Saket', storeId: store.id },
  });

  // Normalizes a Location/csvLocationKeys string for matching: lowercase,
  // strip spaces and hyphens. Declared here (not down by the CSV loop)
  // because it's needed both when POPULATING storeByCsvKey below and when
  // looking rows up against it — using it on one side only was a bug in an
  // earlier version of this seed (multi-word store names like "Punjabi
  // Bagh" never matched because the map key kept its space while the
  // lookup key didn't).
  const normalizeLocation = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '');

  const storeByCsvKey = new Map<string, { id: string; name: string }>();
  storeByCsvKey.set(normalizeLocation('saket'), { id: store.id, name: store.name });

  let nextStoreCode = 11;
  for (const rs of REAL_STORES) {
    const createdStore = await prisma.store.upsert({
      where: { clientId_code: { clientId: client.id, code: rs.code } },
      update: {},
      create: {
        code: rs.code,
        name: rs.name,
        clientId: client.id,
        warehouseTypeId: brandByName[rs.brand].id,
        address: `${rs.name}, Delhi NCR, India`,
        latitude: rs.latitude,
        longitude: rs.longitude,
        geofenceRadius: 200,
        nextEmployeeSerial: 1,
        attendanceMode: AttendanceMode.BIOMETRIC,
      },
    });
    await prisma.device.upsert({
      where: { serialNumber: rs.serialNumber },
      update: { storeId: createdStore.id },
      create: { serialNumber: rs.serialNumber, name: rs.name, storeId: createdStore.id },
    });
    for (const key of rs.csvLocationKeys) {
      storeByCsvKey.set(normalizeLocation(key), { id: createdStore.id, name: createdStore.name });
    }
    nextStoreCode = Math.max(nextStoreCode, Number(rs.code) + 1);
  }
  await prisma.counter.update({ where: { id: `storeCode:${client.id}` }, data: { value: nextStoreCode - 1 } });
  console.log(`✅ Real stores + devices seeded: Saket + ${REAL_STORES.length} more, all under ${client.name}`);

  // ─── Legacy e-code store-segment cross-check ───────────────────────────
  // A subset of EmployeeCode values follow a structured legacy scheme:
  // YYYY (year) + ClientCode (2-digit, "01" = Mansa Maharani here) +
  // StoreCode (2-digit) + Serial (6-digit) — 14 digits total, e.g.
  // "20250101000001" = 2025 + client 01 + store 01 (Saket) + serial 1.
  // Confirmed empirically against this export: 01=Saket, 02=Khizrabad,
  // 03=Punjabi Bagh, 04=Burari, 05=Faridabad Sec-16. Most rows DON'T follow
  // this scheme (ad-hoc SmartOffice-issued codes of varying length), so
  // it's used as a secondary signal, not the primary source of truth:
  //   - If Location gives no store but the code decodes to one, we recover
  //     the employee into that store instead of skipping them.
  //   - If Location AND the code both give a store but they disagree,
  //     that's logged as a mismatch for manual review — Location still wins
  //     (an employee's assignment can legitimately change after their code
  //     was issued), but it's worth a human looking at the printed list.
  const LEGACY_CODE_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{6})$/;
  const LEGACY_CLIENT_CODE = '01'; // Mansa Maharani, per the embedded code
  const LEGACY_STORE_CODE_MAP: Record<string, string> = {
    '01': normalizeLocation('saket'),
    '02': normalizeLocation('khizrabad'),
    '03': normalizeLocation('punjabi bagh'),
    '04': normalizeLocation('burari'),
    '05': normalizeLocation('faridabad sec-16'),
  };

  function decodeLegacyStore(staffCode: string): { id: string; name: string } | null {
    const match = staffCode.match(LEGACY_CODE_PATTERN);
    if (!match) return null;
    const [, , clientSegment, storeSegment] = match;
    if (clientSegment !== LEGACY_CLIENT_CODE) return null;
    const key = LEGACY_STORE_CODE_MAP[storeSegment];
    return key ? storeByCsvKey.get(key) ?? null : null;
  }

  // ─── Real employees (from SmartOffice employee export) ────────────────
  // prisma/seed-data/employee-details-export.csv is the raw
  // EmployeeDetails_Export from SmartOffice. staffCode is kept as the
  // ORIGINAL SmartOffice EmployeeCode (isLegacyCode = true) rather than
  // regenerated through this app's own e-code scheme — AttendanceLog
  // punches are keyed by this same code, so changing it would break the
  // biometric sync join for every one of these employees.
  const employeeCsvPath = path.join(__dirname, 'seed-data', 'employee-details-export.csv');
  const employeeCsvRaw = fs.readFileSync(employeeCsvPath, 'utf-8');
  const employeeCsvLines = employeeCsvRaw.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  const employeeCsvHeader = employeeCsvLines[0].split(',');
  const col = (name: string) => employeeCsvHeader.indexOf(name);

  const idxCode = col('EmployeeCode');
  const idxName = col('EmployeeName');
  const idxLocation = col('Location');
  const idxDesignation = col('Designation');
  const idxGender = col('Gender');
  const idxDOJ = col('DOJ');
  const idxDOB = col('DOB');
  const idxRFID = col('RFID');
  const idxStatus = col('Status');

  const DESIGNATION_MAP: Record<string, Designation | null> = {
    '': Designation.ASSOCIATE,
    'None': Designation.ASSOCIATE,
    'Associate': Designation.ASSOCIATE,
    'House keeping': Designation.HOUSEKEEPING,
    'PA': Designation.PROCESS_ASSOCIATE,
    'QA': Designation.QUALITY_ASSOCIATE,
    'SI': Designation.SHIFT_INCHARGE,
    // Store Managers aren't Employee records in this system (see the
    // Employee model comment: "Managers are NOT employees"). These rows
    // are skipped, not miscategorized — see skip counter below.
    'SM': null,
  };

  const isPlaceholderDate = (s: string) => !s || s === '1900-01-01' || s === '3000-01-01';

  let created = 0;
  let skippedNoStore = 0;
  let skippedManager = 0;
  let skippedTestRow = 0;
  let recoveredViaCode = 0;
  const perStoreCount = new Map<string, number>();
  const storeMismatches: string[] = [];

  for (let i = 1; i < employeeCsvLines.length; i++) {
    const cells = employeeCsvLines[i].split(',');
    const staffCode = cells[idxCode]?.trim();
    const name = cells[idxName]?.trim();
    const location = cells[idxLocation]?.trim();
    const designationRaw = cells[idxDesignation]?.trim() ?? '';
    const status = cells[idxStatus]?.trim();

    if (!staffCode || !name || name === 'TestEmployee1') {
      skippedTestRow++;
      continue;
    }

    const designation = DESIGNATION_MAP[designationRaw];
    if (designation === undefined) {
      // Unrecognized designation value — skip rather than guess.
      skippedTestRow++;
      continue;
    }
    if (designation === null) {
      skippedManager++; // 'SM' rows — Store Manager, not an Employee record here
      continue;
    }

    const locationStore = storeByCsvKey.get(normalizeLocation(location));
    const codeStore = decodeLegacyStore(staffCode);

    let matchedStore = locationStore;
    if (locationStore && codeStore && locationStore.id !== codeStore.id) {
      storeMismatches.push(`${staffCode} (${name}): Location says "${location}" → ${locationStore.name}, but the e-code decodes to ${codeStore.name}. Kept ${locationStore.name} (Location wins).`);
    } else if (!locationStore && codeStore) {
      matchedStore = codeStore; // recovered via embedded store code
      recoveredViaCode++;
    }

    if (!matchedStore) {
      skippedNoStore++; // e.g. Location = "Default" and the code didn't decode either
      continue;
    }

    const dojRaw = cells[idxDOJ]?.trim();
    const dobRaw = cells[idxDOB]?.trim();
    const rfid = cells[idxRFID]?.trim();
    const genderRaw = cells[idxGender]?.trim();

    await prisma.employee.upsert({
      where: { staffCode },
      update: {},
      create: {
        staffCode,
        isLegacyCode: true,
        name,
        gender: genderRaw || null,
        storeId: matchedStore.id,
        designation,
        status: status === 'Working' ? 'ACTIVE' : 'OFFBOARDED',
        dateOfJoining: isPlaceholderDate(dojRaw) ? null : new Date(dojRaw),
        dateOfBirth: isPlaceholderDate(dobRaw) ? null : new Date(dobRaw),
        cardNumber: rfid || null,
      },
    });
    created++;
    perStoreCount.set(matchedStore.name, (perStoreCount.get(matchedStore.name) ?? 0) + 1);
  }

  console.log(`✅ Real employees seeded: ${created} created/updated from employee-details-export.csv`);
  for (const [storeName, count] of perStoreCount) {
    console.log(`   - ${storeName}: ${count}`);
  }
  console.log(`   Skipped: ${skippedNoStore} with no matching store (Location = "Default"/unmapped and e-code didn't decode either), ${skippedManager} Store Manager rows ('SM' designation — not modeled as Employee), ${skippedTestRow} test/malformed rows.`);
  if (recoveredViaCode > 0) {
    console.log(`   ℹ️  ${recoveredViaCode} employee(s) had no usable Location but were assigned via their e-code's embedded store segment instead.`);
  }
  if (storeMismatches.length > 0) {
    console.log(`   ⚠️  ${storeMismatches.length} employee(s) where Location and the e-code's embedded store disagree (Location was kept — review these):`);
    for (const line of storeMismatches) console.log(`      - ${line}`);
  }


  // ─── Second Demo Store: Okhla (Blinkit, MANUAL mode) ──────────────────────
  // Deliberately a different warehouse brand + attendance mode from Saket so
  // there's a real MANUAL-mode store to test CSV upload / Daily Register
  // against, alongside Saket's BIOMETRIC-mode reconciliation flow.
  const blinkit = await prisma.warehouseType.findUnique({ where: { name: 'Blinkit' } });
  if (!blinkit) throw new Error('Blinkit warehouse type not found after seeding');

  const okhla = await prisma.store.upsert({
    where: { clientId_code: { clientId: client.id, code: '21' } },
    update: {},
    create: {
      code: '21',
      name: 'Okhla',
      externalStoreCode: 'DEL_OKH_01',
      clientId: client.id,
      warehouseTypeId: blinkit.id,
      address: 'Okhla Industrial Area, New Delhi, India',
      latitude: 28.5355,
      longitude: 77.2910,
      geofenceRadius: 150,
      nextEmployeeSerial: 1,
      attendanceMode: AttendanceMode.MANUAL,
    },
  });
  await prisma.counter.update({
    where: { id: `storeCode:${client.id}` },
    data: { value: 21 },
  });
  console.log('✅ Demo store:', okhla.name, '(MANUAL mode)');

  // ─── Employees ──────────────────────────────────────────────────────────
  // 5 at Saket (biometric), 5 at Okhla (manual) — enough of a roster to
  // download a real CSV template against and see more than one row.
  const employeeNames = [
    'Ramesh Kumar', 'Suman Devi', 'Ajay Singh', 'Priya Sharma', 'Vikram Yadav',
  ];

  const saketEmployees = await Promise.all(
    employeeNames.map((name, i) =>
      prisma.employee.upsert({
        where: { staffCode: `10101000${i + 1}` },
        update: {},
        create: {
          staffCode: `10101000${i + 1}`,
          name,
          storeId: store.id,
          designation: i === 0 ? Designation.SHIFT_INCHARGE : Designation.ASSOCIATE,
          status: 'ACTIVE',
          dateOfJoining: new Date('2025-01-15'),
        },
      }),
    ),
  );
  await prisma.store.update({ where: { id: store.id }, data: { nextEmployeeSerial: 6 } });
  console.log('✅ Saket employees:', saketEmployees.map((e) => e.staffCode).join(', '));

  const okhlaEmployees = await Promise.all(
    employeeNames.map((name, i) =>
      prisma.employee.upsert({
        where: { staffCode: `10111100${i + 1}` },
        update: {},
        create: {
          staffCode: `10111100${i + 1}`,
          name,
          storeId: okhla.id,
          designation: i === 0 ? Designation.SHIFT_INCHARGE : Designation.ASSOCIATE,
          status: 'ACTIVE',
          dateOfJoining: new Date('2025-03-01'),
        },
      }),
    ),
  );
  await prisma.store.update({ where: { id: okhla.id }, data: { nextEmployeeSerial: 6 } });
  console.log('✅ Okhla employees:', okhlaEmployees.map((e) => e.staffCode).join(', '));

  // ─── Manager + Shift Incharge for Okhla ────────────────────────────────
  const okhlaManagerPasswordHash = await bcrypt.hash('Manager@1234', 12);
  const okhlaManager = await prisma.user.upsert({
    where: { email: 'manager.okhla@mansaraharani.in' },
    update: {},
    create: {
      email: 'manager.okhla@mansaraharani.in',
      passwordHash: okhlaManagerPasswordHash,
      name: 'Okhla Store Manager',
      role: Role.MANAGER,
      clientId: client.id,
      storeId: okhla.id,
      mustChangePassword: true,
    },
  });
  console.log('✅ Demo manager:', okhlaManager.email);

  // Shift Incharge login, linked to their own Employee record (matches the
  // "PA/SI get an app login" rule in the Employee model comments).
  const siPasswordHash = await bcrypt.hash('ShiftIC@1234', 12);
  const shiftIncharge = await prisma.user.upsert({
    where: { email: 'si.okhla@mansaraharani.in' },
    update: {},
    create: {
      email: 'si.okhla@mansaraharani.in',
      passwordHash: siPasswordHash,
      name: okhlaEmployees[0].name,
      role: Role.SHIFT_INCHARGE,
      clientId: client.id,
      storeId: okhla.id,
      employeeId: okhlaEmployees[0].id,
      mustChangePassword: true,
    },
  });
  console.log('✅ Demo shift incharge:', shiftIncharge.email);

  // ─── Attendance deadline policy ────────────────────────────────────────
  // Client default: 5th of the following month. Okhla gets a looser
  // store-level override (10th) — seeds both branches of the resolution
  // order (store override > client default) for immediate testing.
  await prisma.attendanceDeadlinePolicy.upsert({
    where: { clientId: client.id },
    update: {},
    create: { scope: 'CLIENT', clientId: client.id, deadlineDay: 5, createdByUserId: admin.id },
  });
  await prisma.attendanceDeadlinePolicy.upsert({
    where: { storeId: okhla.id },
    update: {},
    create: { scope: 'STORE', storeId: okhla.id, deadlineDay: 10, createdByUserId: admin.id },
  });
  console.log('✅ Deadline policy: Mansa Maharani default = 5th, Okhla override = 10th');

  // ─── Historical manual attendance (Okhla, last month) ──────────────────
  // A handful of already-recorded days so the Daily Register isn't empty on
  // first load, and one employee has otHours set so DAILY_SUM has something
  // real to sum for EmployeeMonthlyOvertime.
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthYear = lastMonth.getFullYear();
  const lastMonthMonth = lastMonth.getMonth() + 1; // 1-12

  const historicalStatuses: ManualAttendanceStatus[] = ['PRESENT', 'PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE'];
  for (let day = 1; day <= 5; day++) {
    const date = new Date(lastMonthYear, lastMonthMonth - 1, day);
    for (let i = 0; i < okhlaEmployees.length; i++) {
      await prisma.manualAttendanceEntry.upsert({
        where: { employeeId_date: { employeeId: okhlaEmployees[i].id, date } },
        update: {},
        create: {
          employeeId: okhlaEmployees[i].id,
          date,
          status: historicalStatuses[i],
          otHours: i === 0 ? 1.5 : null, // Ramesh has some OT on record
          source: 'MANUAL_DAILY_EDIT',
          enteredByUserId: okhlaManager.id,
        },
      });
    }
  }
  const historicalPeriod = await prisma.attendancePeriod.upsert({
    where: { storeId_periodYear_periodMonth: { storeId: okhla.id, periodYear: lastMonthYear, periodMonth: lastMonthMonth } },
    update: {},
    create: {
      storeId: okhla.id,
      periodYear: lastMonthYear,
      periodMonth: lastMonthMonth,
      // Deliberately in the past relative to "now" — this period is seeded
      // as MISSED so you can test the late-access request screen immediately
      // without waiting for a real deadline to pass.
      deadlineAt: new Date(lastMonthYear, lastMonthMonth, 10, 23, 59, 59),
      status: 'MISSED',
    },
  });
  await prisma.employeeMonthlyOvertime.upsert({
    where: { periodId_employeeId: { periodId: historicalPeriod.id, employeeId: okhlaEmployees[0].id } },
    update: {},
    create: {
      periodId: historicalPeriod.id,
      employeeId: okhlaEmployees[0].id,
      totalHours: 1.5,
      source: 'DAILY_SUM',
    },
  });
  console.log(`✅ Historical manual attendance seeded for Okhla (${lastMonthYear}-${String(lastMonthMonth).padStart(2, '0')}, period status = MISSED)`);

  // ─── Biometric punch logs (Saket, current month so far) ────────────────
  // Two punches/day per employee. Ajay Singh gets a deliberately long day
  // (9.5h worked vs the 8h STANDARD_SHIFT_HOURS default) so
  // approximateBiometricOtHours() returns a non-zero figure — upload a Mode
  // A ("daily OT") CSV for Saket with a different value on that day to see
  // the discrepancy flag in the Admin reconciliation tab.
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed, for Date()
  const daysSoFar = Math.min(now.getDate(), 5); // seed up to 5 days, capped at today

  for (let day = 1; day <= daysSoFar; day++) {
    for (let i = 0; i < saketEmployees.length; i++) {
      const emp = saketEmployees[i];
      const checkIn = new Date(currentYear, currentMonth, day, 9, 30, 0);
      const isLongDay = i === 2 && day === 3; // Ajay Singh, one specific day
      const checkOut = new Date(currentYear, currentMonth, day, isLongDay ? 19 : 18, 0, 0);

      await prisma.attendanceLog.upsert({
        where: { employeeCode_logDate_serialNumber: { employeeCode: emp.staffCode, logDate: checkIn, serialNumber: 'SEED-DEVICE-01' } },
        update: {},
        create: { employeeCode: emp.staffCode, logDate: checkIn, serialNumber: 'SEED-DEVICE-01', punchDirection: 'IN' },
      });
      await prisma.attendanceLog.upsert({
        where: { employeeCode_logDate_serialNumber: { employeeCode: emp.staffCode, logDate: checkOut, serialNumber: 'SEED-DEVICE-01' } },
        update: {},
        create: { employeeCode: emp.staffCode, logDate: checkOut, serialNumber: 'SEED-DEVICE-01', punchDirection: 'OUT' },
      });
    }
  }
  console.log(`✅ Biometric punch logs seeded for Saket (${daysSoFar} days) — Ajay Singh has a ~9.5h day on the 3rd for OT-discrepancy testing`);

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Login credentials:');
  console.log('  Admin:          admin@codzen.in               / Admin@1234');
  console.log('  Client:         client@mansaraharani.in        / Client@1234');
  console.log('  Manager, Saket: manager.saket@mansaraharani.in / Manager@1234   (BIOMETRIC store)');
  console.log('  Manager, Okhla: manager.okhla@mansaraharani.in / Manager@1234   (MANUAL store)');
  console.log('  Shift Incharge: si.okhla@mansaraharani.in      / ShiftIC@1234');
  console.log('');
  console.log('Test fixtures for the attendance upload system:');
  console.log(`  - Okhla ${lastMonthYear}-${String(lastMonthMonth).padStart(2, '0')} period is seeded MISSED — try the late-access request flow immediately.`);
  console.log('  - Saket has biometric punch logs with Ajay Singh on a ~9.5h day (the 3rd) — upload a daily-OT CSV with a different value that day to trigger a reconciliation flag.');
  console.log('  - Deadline policy: Mansa Maharani default = 5th of next month, Okhla store override = 10th.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
