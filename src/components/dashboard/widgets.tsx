import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Presentational building blocks for the dashboard. Server-safe (no hooks, no
 * client JS) — every chart here is plain CSS so the page stays fast on phones.
 */

export type Tone = 'default' | 'good' | 'warning' | 'danger';

const VALUE_TONE: Record<Tone, string> = {
  default: 'text-gray-900 dark:text-white',
  good: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
};
const ICON_TONE: Record<Tone, string> = {
  default: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  good: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  danger: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
};
const DOT_TONE: Record<Tone, string> = {
  default: 'bg-slate-400',
  good: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

// ─── Header ────────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, dateLabel }: { title: string; subtitle: string; dateLabel: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">{subtitle}</p>
      </div>
      <p className="text-xs font-medium text-muted-foreground sm:text-sm">{dateLabel}</p>
    </div>
  );
}

// ─── KPI card ──────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, icon: Icon, href, hint, tone = 'default',
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  href?: string;
  hint?: string;
  tone?: Tone;
}) {
  const body = (
    <Card className={`h-full ${href ? 'transition-colors hover:border-primary/40 active:bg-slate-50 dark:active:bg-slate-800' : ''}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium leading-snug text-muted-foreground sm:text-sm">{label}</p>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ICON_TONE[tone]}`}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <p className={`mt-2 text-2xl font-bold tabular-nums sm:text-3xl ${VALUE_TONE[tone]}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>;
}

// ─── Section card wrapper ──────────────────────────────────────────────────

export function Section({
  title, action, children, className = '',
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2 sm:p-5 sm:pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {action && (
          <Link href={action.href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {action.label} <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-2 sm:p-5 sm:pt-2">{children}</CardContent>
    </Card>
  );
}

// ─── Needs attention ───────────────────────────────────────────────────────

export interface AttentionItem {
  label: string;
  count: number;
  href: string;
  tone: Exclude<Tone, 'default' | 'good'>;
  hint?: string;
}

export function AttentionList({ items }: { items: AttentionItem[] }) {
  const open = items.filter((i) => i.count > 0).sort((a, b) => (a.tone === b.tone ? b.count - a.count : a.tone === 'danger' ? -1 : 1));
  return (
    <Section title="Needs attention">
      {open.length === 0 ? (
        <div className="flex items-center gap-3 py-4 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <span>All clear — nothing is waiting on you right now.</span>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {open.map((i) => (
            <li key={i.label}>
              <Link href={i.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/60">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT_TONE[i.tone]}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{i.label}</span>
                  {i.hint && <span className="block text-xs text-muted-foreground">{i.hint}</span>}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${ICON_TONE[i.tone]}`}>{i.count}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─── Quick actions ─────────────────────────────────────────────────────────

export function QuickActions({ actions }: { actions: { href: string; label: string; icon: LucideIcon }[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
      {actions.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-slate-50 active:bg-slate-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-slate-800"
        >
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}

// ─── Segmented bar (attendance today / onboarding pipeline) ───────────────

export interface Segment { label: string; value: number; color: string }

export function SegmentedBar({ segments, total, emptyText }: { segments: Segment[]; total: number; emptyText?: string }) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      {total === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{emptyText ?? 'Nothing to show yet.'}</p>
      ) : (
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="img"
          aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}
        >
          {shown.map((s) => (
            <div key={s.label} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} />
          ))}
        </div>
      )}
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.color}`} aria-hidden />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── 7-day bar chart ───────────────────────────────────────────────────────

export function TrendBars({ days, total }: { days: { label: string; value: number; isToday: boolean }[]; total: number }) {
  const max = Math.max(total, ...days.map((d) => d.value), 1);
  return (
    <div>
      <div className="flex h-32 items-end gap-2 sm:gap-3" role="img" aria-label={days.map((d) => `${d.label}: ${d.value}`).join(', ')}>
        {days.map((d) => (
          <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{d.value}</span>
            <div
              className={`w-full rounded-t-md ${d.isToday ? 'bg-primary' : 'bg-primary/35'}`}
              style={{ height: `${Math.max((d.value / max) * 100, d.value > 0 ? 4 : 1)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 sm:gap-3">
        {days.map((d) => (
          <span key={d.label} className={`flex-1 text-center text-[11px] ${d.isToday ? 'font-semibold' : 'text-muted-foreground'}`}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────

export function timeAgo(date: Date | null | undefined, now = new Date()): string {
  if (!date) return 'never';
  const mins = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} d ago`;
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
