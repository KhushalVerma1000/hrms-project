'use server';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/session';
import {
  AUDIT_ACTIONS,
  actionsForCategory,
  clientVisibleActions,
  criticalActions,
  describeAction,
  summarizeMetadata,
  type AuditCategory,
  type AuditSeverity,
} from '@/lib/audit/catalog';

export interface AuditFilters {
  category?: string;
  action?: string;
  severity?: AuditSeverity;
  search?: string;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd
  page?: number;
}

export interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  label: string;
  category: AuditCategory;
  severity: AuditSeverity;
  actor: string;
  actorRole: string;
  targetType: string;
  target: string;
  summary: string;
  /** ADMIN only — raw metadata for debugging. Never sent to CLIENT users. */
  details: unknown | null;
}

export interface AuditLogResult {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: { today: number; last7Days: number; activeUsers7Days: number; critical7Days: number };
  actionOptions: { value: string; label: string; category: string }[];
}

const PAGE_SIZE = 25;

/**
 * Resolves what a CLIENT is allowed to see. AuditLog has no client column, so
 * an entry is "theirs" if the actor is one of their users OR the target is
 * their client / a store, employee, device, user or period under them (this
 * catches platform-admin actions that affect the client).
 */
async function clientScope(clientId: string): Promise<Prisma.AuditLogWhereInput> {
  const stores = await prisma.store.findMany({ where: { clientId }, select: { id: true } });
  const storeIds = stores.map((s) => s.id);
  const [employees, devices, users, periods] = await Promise.all([
    prisma.employee.findMany({ where: { storeId: { in: storeIds } }, select: { id: true } }),
    prisma.device.findMany({ where: { storeId: { in: storeIds } }, select: { id: true } }),
    prisma.user.findMany({ where: { OR: [{ clientId }, { storeId: { in: storeIds } }] }, select: { id: true } }),
    prisma.attendancePeriod.findMany({ where: { storeId: { in: storeIds } }, select: { id: true } }),
  ]);
  const userIds = users.map((u) => u.id);
  return {
    action: { in: clientVisibleActions() },
    OR: [
      { userId: { in: userIds } },
      { targetType: 'Client', targetId: clientId },
      { targetType: 'Store', targetId: { in: storeIds } },
      { targetType: 'Employee', targetId: { in: employees.map((e) => e.id) } },
      { targetType: 'Device', targetId: { in: devices.map((d) => d.id) } },
      { targetType: 'User', targetId: { in: userIds } },
      { targetType: 'AttendancePeriod', targetId: { in: periods.map((p) => p.id) } },
    ],
  };
}

export async function getAuditLogAction(filters: AuditFilters = {}): Promise<AuditLogResult> {
  const session = await requireAuth('auditLog:view');
  const { role, clientId } = session.user;
  const isAdmin = role === 'ADMIN';

  const empty: AuditLogResult = {
    rows: [], total: 0, page: 1, pageSize: PAGE_SIZE,
    stats: { today: 0, last7Days: 0, activeUsers7Days: 0, critical7Days: 0 },
    actionOptions: [],
  };

  let scope: Prisma.AuditLogWhereInput = {};
  if (!isAdmin) {
    if (!clientId) return empty;
    scope = await clientScope(clientId);
  }

  // ── user-chosen filters, layered on top of the (non-bypassable) scope ──
  const and: Prisma.AuditLogWhereInput[] = [scope];
  if (filters.action && AUDIT_ACTIONS[filters.action]) {
    and.push({ action: filters.action });
  } else if (filters.category) {
    and.push({ action: { in: actionsForCategory(filters.category, isAdmin) } });
  }
  if (filters.severity) {
    const crit = criticalActions();
    const notice = Object.entries(AUDIT_ACTIONS).filter(([, m]) => m.severity === 'notice').map(([k]) => k);
    and.push({ action: { in: filters.severity === 'critical' ? crit : filters.severity === 'notice' ? notice : Object.keys(AUDIT_ACTIONS).filter((k) => !crit.includes(k) && !notice.includes(k)) } });
  }
  if (filters.from || filters.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) createdAt.gte = new Date(`${filters.from}T00:00:00`);
    if (filters.to) createdAt.lte = new Date(`${filters.to}T23:59:59.999`);
    and.push({ createdAt });
  }
  const q = filters.search?.trim();
  if (q) {
    and.push({
      OR: [
        { targetId: q },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  const where: Prisma.AuditLogWhereInput = { AND: and };

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const since7 = new Date(startToday.getTime() - 6 * 86400000);

  const [logs, total, today, last7Days, actors7, critical7Days] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.count({ where: { AND: [scope, { createdAt: { gte: startToday } }] } }),
    prisma.auditLog.count({ where: { AND: [scope, { createdAt: { gte: since7 } }] } }),
    prisma.auditLog.groupBy({ by: ['userId'], where: { AND: [scope, { createdAt: { gte: since7 } }] } }),
    prisma.auditLog.count({ where: { AND: [scope, { createdAt: { gte: since7 } }, { action: { in: criticalActions() } }] } }),
  ]);

  // ── resolve target ids to readable names (one query per type, page-sized) ──
  const idsOf = (t: string) => [...new Set(logs.filter((l) => l.targetType === t).map((l) => l.targetId))];
  const [emps, stores, clients, devs, usrs, wts] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: idsOf('Employee') } }, select: { id: true, name: true, staffCode: true } }),
    prisma.store.findMany({ where: { id: { in: idsOf('Store') } }, select: { id: true, name: true } }),
    prisma.client.findMany({ where: { id: { in: idsOf('Client') } }, select: { id: true, name: true } }),
    prisma.device.findMany({ where: { id: { in: idsOf('Device') } }, select: { id: true, name: true, serialNumber: true } }),
    prisma.user.findMany({ where: { id: { in: idsOf('User') } }, select: { id: true, name: true } }),
    prisma.warehouseType.findMany({ where: { id: { in: idsOf('WarehouseType') } }, select: { id: true, name: true } }),
  ]);
  const names = new Map<string, string>();
  emps.forEach((e) => names.set(`Employee:${e.id}`, `${e.name} (${e.staffCode})`));
  stores.forEach((s) => names.set(`Store:${s.id}`, s.name));
  clients.forEach((c) => names.set(`Client:${c.id}`, c.name));
  devs.forEach((d) => names.set(`Device:${d.id}`, `${d.name} (${d.serialNumber})`));
  usrs.forEach((u) => names.set(`User:${u.id}`, u.name));
  wts.forEach((w) => names.set(`WarehouseType:${w.id}`, w.name));

  const rows: AuditRow[] = logs.map((l) => {
    const meta = describeAction(l.action);
    // Clients see "Platform Admin", not the individual admin's identity.
    const actorIsAdmin = l.user.role === 'ADMIN';
    return {
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      action: l.action,
      label: meta.label,
      category: meta.category,
      severity: meta.severity,
      actor: !isAdmin && actorIsAdmin ? 'Platform Admin' : l.user.name,
      actorRole: l.user.role,
      targetType: l.targetType,
      target: names.get(`${l.targetType}:${l.targetId}`) ?? '—',
      summary: summarizeMetadata(l.action, l.metadata),
      details: isAdmin ? l.metadata ?? null : null,
    };
  });

  const actionOptions = Object.entries(AUDIT_ACTIONS)
    .filter(([, m]) => isAdmin || !m.adminOnly)
    .map(([value, m]) => ({ value, label: m.label, category: m.category }));

  return {
    rows, total, page, pageSize: PAGE_SIZE,
    stats: { today, last7Days, activeUsers7Days: actors7.length, critical7Days },
    actionOptions,
  };
}
