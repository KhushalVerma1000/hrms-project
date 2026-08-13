import { PrismaClient, Role, Designation, OnboardingFormStatus } from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';

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
      nextEmployeeSerial: 1,
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

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Login credentials:');
  console.log('  Admin:   admin@codzen.in         / Admin@1234');
  console.log('  Client:  client@mansaraharani.in / Client@1234');
  console.log('  Manager: manager.saket@mansaraharani.in / Manager@1234');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
