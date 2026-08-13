'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getManualAttendanceForDate,
  saveManualAttendanceBatch,
  type ManualAttendanceInput,
} from '@/app/(app)/attendance/manual/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_OPTIONS = [
  { value: 'PRESENT', label: 'Present', className: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'ABSENT', label: 'Absent', className: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'HALF_DAY', label: 'Half Day', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'ON_LEAVE', label: 'On Leave', className: 'bg-blue-50 text-blue-700 border-blue-200' },
] as const;

interface RosterRow {
  id: string;
  name: string;
  staffCode: string;
  designation: string;
  existingEntry: {
    status: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    notes: string | null;
  } | null;
}

interface StoreOption {
  id: string;
  name: string;
  client: { shortName: string };
}

interface RowState {
  status: string;
  checkInTime: string;
  checkOutTime: string;
  notes: string;
  dirty: boolean;
}

export function ManualAttendanceForm({
  stores,
  selectedStoreId,
  selectedDate,
}: {
  stores: StoreOption[];
  selectedStoreId: string;
  selectedDate: string;
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(selectedStoreId);
  const [date, setDate] = useState(selectedDate);
  const [storeName, setStoreName] = useState('');
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getManualAttendanceForDate(storeId, date);
      setStoreName(data.store.name);
      setRoster(data.roster);
      const initial: Record<string, RowState> = {};
      for (const emp of data.roster) {
        initial[emp.id] = {
          status: emp.existingEntry?.status ?? 'PRESENT',
          checkInTime: emp.existingEntry?.checkInTime
            ? new Date(emp.existingEntry.checkInTime).toTimeString().slice(0, 5)
            : '',
          checkOutTime: emp.existingEntry?.checkOutTime
            ? new Date(emp.existingEntry.checkOutTime).toTimeString().slice(0, 5)
            : '',
          notes: emp.existingEntry?.notes ?? '',
          dirty: false,
        };
      }
      setRowState(initial);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, [storeId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const updateRow = (employeeId: string, patch: Partial<RowState>) => {
    setRowState((prev) => ({
      ...prev,
      [employeeId]: { ...prev[employeeId]!, ...patch, dirty: true },
    }));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const entries: ManualAttendanceInput[] = Object.entries(rowState)
        .filter(([, state]) => state.dirty)
        .map(([employeeId, state]) => ({
          employeeId,
          status: state.status as ManualAttendanceInput['status'],
          checkInTime: state.checkInTime || undefined,
          checkOutTime: state.checkOutTime || undefined,
          notes: state.notes || undefined,
        }));

      if (entries.length === 0) {
        toast.info('No changes to save.');
        return;
      }

      const res = await saveManualAttendanceBatch(storeId, date, entries);
      if (!res.ok) {
        toast.error(res.error || 'Failed to save attendance');
        return;
      }
      toast.success(`Saved attendance for ${res.saved} employee(s)`);
      load(); // reload to clear dirty state and reflect saved values
    } catch (err: any) {
      toast.error(err.message || 'Failed to save attendance');
    } finally {
      setSaving(false);
    }
  };

  const handleStoreChange = (newStoreId: string) => {
    setStoreId(newStoreId);
    router.replace(`/attendance/manual?storeId=${newStoreId}&date=${date}`);
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    router.replace(`/attendance/manual?storeId=${storeId}&date=${newDate}`);
  };

  const dirtyCount = Object.values(rowState).filter((s) => s.dirty).length;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="w-6 h-6" /> Manual Attendance
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          This store has no biometric device configured — record daily attendance directly here.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end">
        {stores.length > 1 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Store</label>
            <Select value={storeId} onValueChange={handleStoreChange}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.client.shortName} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Date</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className="w-44"
          />
        </div>

        <Button
          onClick={handleSaveAll}
          disabled={saving || dirtyCount === 0}
          className="ml-auto"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save{dirtyCount > 0 ? ` (${dirtyCount} changed)` : ''}
        </Button>
      </div>

      {/* Roster table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{storeName} — {date}</CardTitle>
          <CardDescription>
            {loading
              ? 'Loading roster…'
              : `${roster.length} active employee${roster.length !== 1 ? 's' : ''}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : roster.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              No active employees found for this store.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((emp) => {
                  const state = rowState[emp.id];
                  if (!state) return null;
                  const statusOption = STATUS_OPTIONS.find((o) => o.value === state.status);
                  return (
                    <TableRow key={emp.id} className={state.dirty ? 'bg-amber-50/50' : undefined}>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{emp.staffCode}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {emp.designation.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={state.status}
                          onValueChange={(v) => updateRow(emp.id, { status: v })}
                        >
                          <SelectTrigger className={`w-36 text-xs border ${statusOption?.className ?? ''}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={state.checkInTime}
                          onChange={(e) => updateRow(emp.id, { checkInTime: e.target.value })}
                          className="w-28 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={state.checkOutTime}
                          onChange={(e) => updateRow(emp.id, { checkOutTime: e.target.value })}
                          className="w-28 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          value={state.notes}
                          onChange={(e) => updateRow(emp.id, { notes: e.target.value })}
                          placeholder="Optional note"
                          className="w-40 text-xs"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
