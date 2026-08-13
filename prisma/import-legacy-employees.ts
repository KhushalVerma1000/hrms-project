/**
 * ONE-OFF IMPORT SCRIPT — legacy SmartOffice employee data → local Postgres.
 *
 * BEFORE RUNNING: export CSV and prepare a client-mapping.json as described in the
 * project's docs. Run with --dry-run to preview changes.
 */

import { PrismaClient, Designation } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { assignWarehouseTypeCode, assignStoreCode } from '../src/lib/ecode';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`--${flag}=`));
    return arg ? arg.split('=').slice(1).join('=') : undefined;
  };
  return {
    csvPath: get('csv'),
    mappingPath: get('mapping'),
    dryRun: args.includes('--dry-run'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal CSV parser (handles quoted fields with commas; no external deps)
// ─────────────────────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields.map((f) => f.trim());
  }

  const headers = parseLine(lines[0]!).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

/** Case-insensitive column lookup, since export headers can vary slightly. */
function col(row: Record<string, string>, ...names: string[]): string {
  const lowerNames = names.map((n) => n.toLowerCase());
  for (const key of Object.keys(row)) {
    if (lowerNames.includes(key.toLowerCase())) return row[key]?.trim() ?? '';
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main import logic
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const { csvPath, mappingPath, defaultClient, dryRun } = parseArgs();

  if (!csvPath || !mappingPath) {
    console.error(
      'Usage: ts-node prisma/import-legacy-employees.ts --csv=./file.csv --mapping=./client-mapping.json [--dry-run]',
    );
    process.exit(1);
  }

  const csvText = fs.readFileSync(path.resolve(csvPath), 'utf8');
  const clientMapping: Record<string, string> = JSON.parse(
    fs.readFileSync(path.resolve(mappingPath), 'utf8'),
  );
  // Normalize mapping keys to lowercase for case-insensitive lookup
  const normalizedMapping = new Map(
    Object.entries(clientMapping).map(([k, v]) => [k.toLowerCase(), v]),
  );

  const rows = parseCsv(csvText);
  console.log(`📄 Parsed ${rows.length} rows from ${csvPath}`);

  const stats = {
    imported: 0,
    skippedExisting: 0,
    skippedNoLocation: 0,
    skippedUnmappedLocation: new Set<string>(),
    skippedUnmappedClient: new Set<string>(),
    warehouseTypesCreated: [] as string[],
    storesCreated: [] as string[],
  };

  // Caches to avoid repeat DB lookups within this run
  const warehouseTypeCache = new Map<string, string>(); // name(lower) -> id
  const storeCache = new Map<string, string>(); // `${clientId}:${locationName lower}` -> storeId
  const clientCache = new Map<string, string>(); // name(lower) -> id

  for (const row of rows) {
    const staffCode = col(row, 'Employee Code', 'EmployeeCode', 'Staff Code');
    const name = col(row, 'Employee Name', 'EmployeeName', 'Name');
    const branch = col(row, 'Branch', 'CompanySName');
    const location = col(row, 'Location');
    const category = col(row, 'Category', 'Designation');

    if (!staffCode || !name) {
      console.warn(`⚠️  Skipping row with missing Employee Code or Name: ${JSON.stringify(row)}`);
      continue;
    }

    if (!location) {
      stats.skippedNoLocation++;
      console.warn(`⚠️  Skipping ${staffCode} (${name}) — no Location value.`);
      continue;
    }

    // Resolve Client from mapping, falling back to --default-client
    const clientName = normalizedMapping.get(location.toLowerCase()) || defaultClient;
    if (!clientName) {
      stats.skippedUnmappedLocation.add(location);
      continue; // reported in summary at the end
    }

    let clientId = clientCache.get(clientName.toLowerCase());
    if (!clientId) {
      let client = await prisma.client.findFirst({
        where: { name: { equals: clientName, mode: 'insensitive' } },
      });
      if (!client) {
        if (dryRun) {
          console.log(`[DRY RUN] Would create Client "${clientName}"`);
          clientId = `dryrun-client-${clientName}`;
        } else {
          client = await prisma.$transaction(async (tx) => {
            const code = await assignClientCode(tx);
            return tx.client.create({
              data: { code, name: clientName, shortName: clientName.slice(0, 10).toUpperCase() },
            });
          });
          console.log(`✅ Created Client "${clientName}" (code ${client.code})`);
        }
      }
      clientId = client?.id ?? clientId!;
      clientCache.set(clientName.toLowerCase(), clientId);
    }

    // Resolve or create WarehouseType from Branch
    const branchName = branch || 'Unknown';
    let warehouseTypeId = warehouseTypeCache.get(branchName.toLowerCase());
    if (!warehouseTypeId) {
      let wt = await prisma.warehouseType.findFirst({
        where: { name: { equals: branchName, mode: 'insensitive' } },
      });
      if (!wt) {
        if (dryRun) {
          console.log(`[DRY RUN] Would create WarehouseType "${branchName}"`);
          warehouseTypeId = `dryrun-wt-${branchName}`;
        } else {
          wt = await prisma.$transaction(async (tx) => {
            const code = await assignWarehouseTypeCode(tx);
            return tx.warehouseType.create({ data: { code, name: branchName } });
          });
          stats.warehouseTypesCreated.push(branchName);
          console.log(`✅ Created WarehouseType "${branchName}" (code ${wt.code})`);
        }
      }
      warehouseTypeId = wt?.id ?? warehouseTypeId!;
      warehouseTypeCache.set(branchName.toLowerCase(), warehouseTypeId);
    }

    // Resolve or create Store from Location (+ Client + WarehouseType)
    const storeCacheKey = `${clientId}:${location.toLowerCase()}`;
    let storeId = storeCache.get(storeCacheKey);
    if (!storeId) {
      let store = await prisma.store.findFirst({
        where: { clientId, name: { equals: location, mode: 'insensitive' } },
      });
      if (!store) {
        if (dryRun) {
          console.log(`[DRY RUN] Would create Store "${location}" under client "${clientName}"`);
          storeId = `dryrun-store-${location}`;
        } else {
          store = await prisma.$transaction(async (tx) => {
            const code = await assignStoreCode(tx, clientId!);
            return tx.store.create({
              data: { code, name: location, clientId: clientId!, warehouseTypeId: warehouseTypeId! },
            });
          });
          stats.storesCreated.push(`${location} (${clientName})`);
          console.log(`✅ Created Store "${location}" under "${clientName}" (code ${store.code})`);
        }
      }
      storeId = store?.id ?? storeId!;
      storeCache.set(storeCacheKey, storeId);
    }

    // Check for existing employee with this staffCode — never overwrite
    const existing = await prisma.employee.findUnique({ where: { staffCode } });
    if (existing) {
      stats.skippedExisting++;
      continue;
    }

    // Best-effort designation mapping — defaults to ASSOCIATE if Category
    // doesn't match a known designation. Reclassify manually afterward if needed.
    const designation = mapCategoryToDesignation(category);

    if (dryRun) {
      console.log(`[DRY RUN] Would import ${staffCode} — ${name} (${designation}) @ ${location}`);
    } else {
      await prisma.employee.create({
        data: {
          staffCode,
          name,
          storeId: storeId!,
          designation,
          isLegacyCode: true,
          status: 'ACTIVE',
        },
      });
    }
    stats.imported++;
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log('\n📊 Import Summary');
  console.log(`   Imported:                 ${stats.imported}${dryRun ? ' (dry run — nothing written)' : ''}`);
  console.log(`   Skipped (already exists): ${stats.skippedExisting}`);
  console.log(`   Skipped (no Location):    ${stats.skippedNoLocation}`);
  console.log(`   WarehouseTypes created:    ${stats.warehouseTypesCreated.join(', ') || 'none'}`);
  console.log(`   Stores created:            ${stats.storesCreated.join(', ') || 'none'}`);

  if (stats.skippedUnmappedLocation.size > 0) {
    console.log(`\n❌ Unmapped Locations (add these to client-mapping.json and re-run):`);
    for (const loc of stats.skippedUnmappedLocation) console.log(`   - "${loc}"`);
  }
  if (stats.skippedUnmappedClient.size > 0) {
    console.log(`\n❌ Client names in mapping that don't match any existing Client record:`);
    for (const c of stats.skippedUnmappedClient) console.log(`   - "${c}" — create this Client in the app first`);
  }
}

/** Maps the export's "Category" column to a Designation, if recognizable. */
function mapCategoryToDesignation(category: string): Designation {
  const c = category.toLowerCase();
  if (c.includes('shift') && c.includes('incharge')) return Designation.SHIFT_INCHARGE;
  if (c.includes('process')) return Designation.PROCESS_ASSOCIATE;
  if (c.includes('quality')) return Designation.QUALITY_ASSOCIATE;
  if (c.includes('associate')) return Designation.ASSOCIATE;
  return Designation.ASSOCIATE; // safe default — reclassify manually in the app if wrong
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
