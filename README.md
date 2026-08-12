# HRMS Platform — Warehouse Workforce & Attendance

A multi-tenant workforce onboarding and attendance management platform built on top of SmartOffice Biometrics & HRMS.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Server Actions)
- **Language:** TypeScript (strict mode)
- **Database:** PostgreSQL via Prisma Postgres
- **ORM:** Prisma
- **Auth:** Auth.js v5 (Credentials provider)
- **UI:** Tailwind CSS + shadcn/ui
- **Validation:** Zod
- **Queue:** pg-boss (Postgres-backed job queue)
- **Worker hosting:** Render.com Web Service

## Getting Started

### 1. Environment Setup

```bash
cp .env.example .env.local
```

Fill in all required variables. See `.env.example` for documentation on each.

**Critical:** `DATABASE_DIRECT_URL` must be a **non-pooled** direct Postgres connection. pg-boss requires this — it breaks under PgBouncer transaction-pooling mode.

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

```bash
npm run db:generate    # Generate Prisma client
npm run db:migrate     # Run migrations
npm run db:seed        # Seed demo data
```

### 4. Run the App

```bash
npm run dev
```

### 5. Run the Worker (separate terminal)

The SmartOffice command queue worker must run as a **separate always-on process**.
It cannot run inside Vercel serverless functions.

```bash
npm run worker
```

For production, deploy the worker to Render.com as a Web Service.

## Seed Accounts

| Role    | Email                              | Password      |
|---------|-------------------------------------|---------------|
| Admin   | admin@codzen.in                     | Admin@1234    |
| Client  | client@mansaraharani.in             | Client@1234   |
| Manager | manager.saket@mansaraharani.in      | Manager@1234  |

> **Security:** Change all passwords immediately after first login in production.

## SmartOffice Timezone

By default, SmartOffice timestamps are assumed to be **IST (Asia/Kolkata)**.
To change this, set `SMARTOFFICE_TIMEZONE` in your `.env.local`.

To verify the assumption: punch a device at a known wall-clock time, pull that
punch via `GetDeviceLogs`, and compare. If it's off by ~5h30m, your instance is
using UTC — set `SMARTOFFICE_TIMEZONE=UTC`.

## Architecture Notes

### Local-first + Async Command Queue
Every write to SmartOffice goes through the `SmartOfficeCommand` queue:
1. Write to local Postgres (source of truth for the app)
2. Enqueue a command row in the same transaction
3. Worker dispatches it with retry/backoff
4. UI shows sync status badge per record

This makes the app resilient to SmartOffice downtime.

### E-Code Generation
Employee codes are 10-digit system-generated codes: `[Client:2][Brand:2][Store:2][Serial:4]`
All codes are auto-assigned — no manual entry anywhere in the pipeline.

### Role Hierarchy
- **Admin** — full platform access
- **Client** — own client scope
- **Manager** — own store scope (no Employee record / biometric enrollment)
- **Process Associate / Shift Incharge** — own store, limited permissions (also have Employee records for attendance)
- **Associate / Quality Associate** — no app access, Employee records only
