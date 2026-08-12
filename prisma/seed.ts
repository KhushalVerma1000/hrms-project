import { PrismaClient, Role, Designation, OnboardingFormStatus } from '@prisma/client';
// @ts-ignore
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // ─── Counters ─────────────────────────────────────────────────────────────
  await prisma.counter.upsert({
    where: { id: 'client' },
    update: {},
    create: { id: 'client', value: 0 },
  });
  await prisma.counter.upsert({
    where: { id: 'warehouseType' },
    update: {},
    create: { id: 'warehouseType', value: 0 },
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
    { name: 'Amazon', code: '01' },
    { name: 'Blinkit', code: '02' },
    { name: 'Zepto', code: '03' },
  ];

  for (const wt of warehouseTypes) {
    await prisma.warehouseType.upsert({
      where: { name: wt.name },
      update: {},
      create: { code: wt.code, name: wt.name },
    });
  }
  // Sync counter to reflect seeded warehouse types
  await prisma.counter.update({
    where: { id: 'warehouseType' },
    data: { value: warehouseTypes.length },
  });
  console.log('✅ Warehouse types seeded:', warehouseTypes.map((w) => w.name).join(', '));

  // ─── Demo Client: Mansa Maharani ──────────────────────────────────────────
  const client = await prisma.client.upsert({
    where: { code: '01' },
    update: {},
    create: {
      code: '01',
      name: 'Mansa Maharani',
      shortName: 'MM',
      email: 'ops@mansamaharani.in',
    },
  });
  await prisma.counter.update({
    where: { id: 'client' },
    data: { value: 1 },
  });
  console.log('✅ Demo client:', client.name);

  // Initialise per-client store counter
  await prisma.counter.upsert({
    where: { id: `storeCode:${client.id}` },
    update: {},
    create: { id: `storeCode:${client.id}`, value: 0 },
  });

  // ─── Demo Store: Saket (Amazon) ───────────────────────────────────────────
  const amazon = await prisma.warehouseType.findUnique({ where: { name: 'Amazon' } });
  if (!amazon) throw new Error('Amazon warehouse type not found after seeding');

  const store = await prisma.store.upsert({
    where: { clientId_code: { clientId: client.id, code: '01' } },
    update: {},
    create: {
      code: '01',
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
    data: { value: 1 },
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
