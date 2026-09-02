'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getDeadlinePolicyForClient,
  setClientDeadlineDefault,
  setStoreDeadlineOverride,
  clearStoreDeadlineOverride,
  listStoresForClient,
  approveLateAccess,
  denyLateAccess,
  clearOvertimeDiscrepancy,
} from '@/app/(app)/attendance/deadlines/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Settings, Inbox, AlertTriangle, Check, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface ClientOption { id: string; name: string; shortName: string }
interface PendingRequest {
  id: string; storeName: string; clientId: string; periodYear: number; periodMonth: number;
  requestedByName: string; requestedByEmail: string; requestedAt: string; reason: string | null;
}
interface Discrepancy {
  id: string; employeeName: string; staffCode: string; periodYear: number; periodMonth: number; totalHours: string;
}

export function AttendanceAdminPanel({
  clients,
  pendingRequests,
  discrepancies,
}: {
  clients: ClientOption[];
  pendingRequests: PendingRequest[];
  discrepancies: Discrepancy[];
}) {
  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6" /> Attendance Deadlines &amp; Reconciliation
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Set monthly upload deadlines, review late-access requests, and reconcile overtime discrepancies.
        </p>
      </div>

      <Tabs defaultValue="deadlines">
        <TabsList>
          <TabsTrigger value="deadlines">Deadline Policy</TabsTrigger>
          <TabsTrigger value="requests">
            Late Access Requests {pendingRequests.length > 0 && <Badge className="ml-1.5">{pendingRequests.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="reconciliation">
            OT Reconciliation {discrepancies.length > 0 && <Badge className="ml-1.5">{discrepancies.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deadlines">
          <DeadlinePolicyTab clients={clients} />
        </TabsContent>

        <TabsContent value="requests">
          <LateRequestsTab initialRequests={pendingRequests} />
        </TabsContent>

        <TabsContent value="reconciliation">
          <ReconciliationTab initialDiscrepancies={discrepancies} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Tab 1: Deadline policy ──────────────────────────────────────────────

function DeadlinePolicyTab({ clients }: { clients: ClientOption[] }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultDay, setDefaultDay] = useState('5');
  const [overrides, setOverrides] = useState<{ id: string; storeId: string | null; deadlineDay: number; store: { id: string; name: string } | null }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [newOverrideStoreId, setNewOverrideStoreId] = useState('');
  const [newOverrideDay, setNewOverrideDay] = useState('5');

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const [policy, storeList] = await Promise.all([
        getDeadlinePolicyForClient(clientId),
        listStoresForClient(clientId),
      ]);
      setDefaultDay(String(policy.clientDefault?.deadlineDay ?? 5));
      setOverrides(policy.storeOverrides as any);
      setStores(storeList);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load deadline policy');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveDefault = async () => {
    setSaving(true);
    try {
      const res = await setClientDeadlineDefault(clientId, Number(defaultDay));
      if (!res.ok) {
        toast.error(res.error || 'Failed to save');
        return;
      }
      toast.success('Client default deadline saved.');
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAddOverride = async () => {
    if (!newOverrideStoreId) {
      toast.error('Pick a store first.');
      return;
    }
    setSaving(true);
    try {
      const res = await setStoreDeadlineOverride(newOverrideStoreId, Number(newOverrideDay));
      if (!res.ok) {
        toast.error(res.error || 'Failed to save');
        return;
      }
      toast.success('Store override saved.');
      setNewOverrideStoreId('');
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClearOverride = async (storeId: string) => {
    try {
      await clearStoreDeadlineOverride(storeId);
      toast.success('Override cleared — this store now follows the client default.');
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear override');
    }
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="space-y-1 max-w-xs">
        <Label className="text-xs font-medium text-gray-500">Client</Label>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Client default</CardTitle>
              <CardDescription>Applies to every store under this client, unless a store has its own override below.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-500">Day of the following month</Label>
                <Input type="number" min={1} max={28} value={defaultDay} onChange={(e) => setDefaultDay(e.target.value)} className="w-24" />
              </div>
              <Button onClick={handleSaveDefault} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Save
              </Button>
              <p className="text-xs text-gray-400 pb-2">
                e.g. 5 = attendance for August is due before 5 September.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Store overrides</CardTitle>
              <CardDescription>Give one store a different deadline than the client default.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-gray-500">Store</Label>
                  <Select value={newOverrideStoreId} onValueChange={setNewOverrideStoreId}>
                    <SelectTrigger className="w-52">
                      <SelectValue placeholder="Select a store" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-gray-500">Deadline day</Label>
                  <Input type="number" min={1} max={28} value={newOverrideDay} onChange={(e) => setNewOverrideDay(e.target.value)} className="w-24" />
                </div>
                <Button variant="outline" onClick={handleAddOverride} disabled={saving}>Add override</Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Store</TableHead>
                    <TableHead>Deadline day</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overrides.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-gray-400 text-sm py-6">No store overrides — every store follows the client default.</TableCell></TableRow>
                  ) : (
                    overrides.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>{o.store?.name}</TableCell>
                        <TableCell>{o.deadlineDay}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => o.storeId && handleClearOverride(o.storeId)}>
                            <Trash2 className="w-4 h-4 text-gray-400" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Tab 2: Late-access requests ─────────────────────────────────────────

function LateRequestsTab({ initialRequests }: { initialRequests: PendingRequest[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [grantDays, setGrantDays] = useState<Record<string, string>>({});
  const [adminNote, setAdminNote] = useState<Record<string, string>>({});

  const handleApprove = async (id: string) => {
    const days = Number(grantDays[id] ?? '3');
    const grantedUntil = new Date();
    grantedUntil.setDate(grantedUntil.getDate() + (Number.isFinite(days) ? days : 3));

    setBusyId(id);
    try {
      const res = await approveLateAccess(id, grantedUntil, adminNote[id]);
      if (!res.ok) {
        toast.error(res.error || 'Failed to approve');
        return;
      }
      toast.success(`Approved — upload open until ${grantedUntil.toLocaleDateString()}.`);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeny = async (id: string) => {
    setBusyId(id);
    try {
      const res = await denyLateAccess(id, adminNote[id]);
      if (!res.ok) {
        toast.error(res.error || 'Failed to deny');
        return;
      }
      toast.success('Request denied.');
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      toast.error(err.message || 'Failed to deny');
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 mt-4">
        <Inbox className="w-8 h-8 mx-auto mb-2" />
        No pending late-access requests.
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {requests.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {r.storeName} — {MONTH_NAMES[r.periodMonth - 1]} {r.periodYear}
            </CardTitle>
            <CardDescription>
              {r.requestedByName} ({r.requestedByEmail}) · {new Date(r.requestedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {r.reason && <p className="text-sm bg-slate-50 border rounded-md p-3">&quot;{r.reason}&quot;</p>}
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-500">Grant access for (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={grantDays[r.id] ?? '3'}
                  onChange={(e) => setGrantDays((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  className="w-24"
                />
              </div>
              <div className="space-y-1 flex-1 min-w-48">
                <Label className="text-xs font-medium text-gray-500">Note (optional)</Label>
                <Input
                  value={adminNote[r.id] ?? ''}
                  onChange={(e) => setAdminNote((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  placeholder="Visible to the manager"
                />
              </div>
              <Button onClick={() => handleApprove(r.id)} disabled={busyId === r.id}>
                {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                Approve
              </Button>
              <Button variant="outline" onClick={() => handleDeny(r.id)} disabled={busyId === r.id}>
                <X className="w-4 h-4 mr-2" /> Deny
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Tab 3: OT reconciliation ────────────────────────────────────────────

function ReconciliationTab({ initialDiscrepancies }: { initialDiscrepancies: Discrepancy[] }) {
  const [discrepancies, setDiscrepancies] = useState(initialDiscrepancies);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleClear = async (id: string) => {
    setBusyId(id);
    try {
      await clearOvertimeDiscrepancy(id);
      toast.success('Marked as reconciled.');
      setDiscrepancies((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear');
    } finally {
      setBusyId(null);
    }
  };

  if (discrepancies.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 mt-4">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
        No overtime discrepancies flagged.
      </div>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Flagged overtime</CardTitle>
        <CardDescription>
          Uploaded daily OT differs from device-calculated OT for these employee-months. Review and clear once resolved.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Total OT (hrs)</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {discrepancies.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.employeeName} <span className="text-xs text-gray-400 font-mono">({d.staffCode})</span></TableCell>
                <TableCell>{MONTH_NAMES[d.periodMonth - 1]} {d.periodYear}</TableCell>
                <TableCell>{d.totalHours}</TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => handleClear(d.id)} disabled={busyId === d.id}>
                    {busyId === d.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                    Mark reviewed
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
