'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  getUploadPageContext,
  validateUploadBatch,
  commitUploadBatch,
  requestLateAccess,
  type UploadPageContext,
} from '@/app/(app)/attendance/upload/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Loader2, Upload, Download, CalendarDays, Lock, Clock, CheckCircle2,
  AlertTriangle, XCircle, Send,
} from 'lucide-react';
import { toast } from 'sonner';

interface StoreOption {
  id: string;
  name: string;
  attendanceMode: 'BIOMETRIC' | 'MANUAL';
  client: { shortName: string };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_BADGE: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  OPEN: { label: 'Open', className: 'bg-green-50 text-green-700 border-green-200', icon: <Clock className="w-3 h-3" /> },
  CLOSED: { label: 'Submitted', className: 'bg-slate-50 text-slate-700 border-slate-200', icon: <CheckCircle2 className="w-3 h-3" /> },
  CLOSED_LATE: { label: 'Submitted (late)', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: <CheckCircle2 className="w-3 h-3" /> },
  MISSED: { label: 'Deadline missed', className: 'bg-red-50 text-red-700 border-red-200', icon: <XCircle className="w-3 h-3" /> },
  LATE_REQUESTED: { label: 'Late access requested', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="w-3 h-3" /> },
  LATE_GRANTED: { label: 'Late access granted', className: 'bg-blue-50 text-blue-700 border-blue-200', icon: <Clock className="w-3 h-3" /> },
  LATE_DENIED: { label: 'Late access denied', className: 'bg-red-50 text-red-700 border-red-200', icon: <XCircle className="w-3 h-3" /> },
};

interface ValidationIssue {
  rowIndex: number;
  staffCode?: string;
  day?: number;
  column: string;
  severity: 'error' | 'warning';
  message: string;
}

export function AttendanceUploadForm({
  stores,
  selectedStoreId,
  selectedYear,
  selectedMonth,
}: {
  stores: StoreOption[];
  selectedStoreId: string;
  selectedYear: number;
  selectedMonth: number;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [storeId, setStoreId] = useState(selectedStoreId);
  const [year, setYear] = useState(selectedYear);
  const [month, setMonth] = useState(selectedMonth);
  const [otMode, setOtMode] = useState<'daily' | 'total'>('total');

  const [ctx, setCtx] = useState<UploadPageContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [requestingLate, setRequestingLate] = useState(false);
  const [lateReason, setLateReason] = useState('');

  const [preview, setPreview] = useState<{
    batchId: string;
    fileName: string;
    rowCount: number;
    errorCount: number;
    warningCount: number;
    issues: ValidationIssue[];
    canCommit: boolean;
  } | null>(null);

  const store = stores.find((s) => s.id === storeId);

  const load = useCallback(async () => {
    setLoading(true);
    setPreview(null);
    try {
      const data = await getUploadPageContext(storeId, year, month);
      setCtx(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load period status');
    } finally {
      setLoading(false);
    }
  }, [storeId, year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const navigate = (nextStoreId: string, nextYear: number, nextMonth: number) => {
    setStoreId(nextStoreId);
    setYear(nextYear);
    setMonth(nextMonth);
    router.replace(`/attendance/upload?storeId=${nextStoreId}&year=${nextYear}&month=${nextMonth}`);
  };

  const handleDownloadTemplate = () => {
    const url = `/api/attendance/template?storeId=${storeId}&year=${year}&month=${month}&otMode=${otMode}`;
    window.open(url, '_blank');
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setPreview(null);
    try {
      const csvText = await file.text();
      const result = await validateUploadBatch(storeId, year, month, file.name, csvText);
      if (!result.ok) {
        toast.error(result.error || 'Upload failed');
        return;
      }
      setPreview({
        batchId: result.batchId!,
        fileName: file.name,
        rowCount: result.rowCount!,
        errorCount: result.errorCount!,
        warningCount: result.warningCount!,
        issues: result.issues!,
        canCommit: result.canCommit!,
      });
      if (result.errorCount! > 0) {
        toast.error(`${result.errorCount} row(s) need fixing before this can be submitted.`);
      } else if (result.warningCount! > 0) {
        toast.warning(`Looks good — ${result.warningCount} warning(s) to review before submitting.`);
      } else {
        toast.success('No issues found — ready to submit.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Could not read that file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const res = await commitUploadBatch(preview.batchId);
      if (!res.ok) {
        toast.error(res.error || 'Failed to submit');
        return;
      }
      toast.success(`Submitted — ${res.saved} attendance entries saved.`);
      setPreview(null);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit');
    } finally {
      setCommitting(false);
    }
  };

  const handleRequestLateAccess = async () => {
    if (!ctx) return;
    setRequestingLate(true);
    try {
      const res = await requestLateAccess(ctx.periodId, lateReason);
      if (!res.ok) {
        toast.error(res.error || 'Failed to file request');
        return;
      }
      toast.success('Late-access request sent to Admin.');
      setLateReason('');
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to file request');
    } finally {
      setRequestingLate(false);
    }
  };

  const statusInfo = ctx ? STATUS_BADGE[ctx.periodStatus] : null;
  const years = [selectedYear - 1, selectedYear, selectedYear + 1];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Upload className="w-6 h-6" /> Attendance Upload
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Download the sheet, mark statuses, and upload it back before the monthly deadline.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end">
        {stores.length > 1 && (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-gray-500">Store</Label>
            <Select value={storeId} onValueChange={(v) => navigate(v, year, month)}>
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
          <Label className="text-xs font-medium text-gray-500">Month</Label>
          <Select value={String(month)} onValueChange={(v) => navigate(storeId, year, Number(v))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((m, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium text-gray-500">Year</Label>
          <Select value={String(year)} onValueChange={(v) => navigate(storeId, Number(v), month)}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : ctx ? (
        <>
          {/* Period status card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarDays className="w-4 h-4" />
                    {ctx.store.name} — {MONTH_NAMES[month - 1]} {year}
                  </CardTitle>
                  <CardDescription>
                    Deadline: {new Date(ctx.deadlineAt).toLocaleString()} · {ctx.store.attendanceMode === 'BIOMETRIC' ? 'Biometric store (upload used as backup/correction)' : 'Manual-mode store'}
                  </CardDescription>
                </div>
                {statusInfo && (
                  <Badge variant="outline" className={`text-xs gap-1 ${statusInfo.className}`}>
                    {statusInfo.icon} {statusInfo.label}
                  </Badge>
                )}
              </div>
            </CardHeader>
          </Card>

          {/* Blocked states */}
          {!ctx.isWritable && ctx.periodStatus === 'MISSED' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                  <Lock className="w-4 h-4" /> Deadline passed
                </CardTitle>
                <CardDescription>{ctx.blockedReason}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label className="text-xs font-medium text-gray-500">Reason for the delay (shown to Admin)</Label>
                <Input
                  value={lateReason}
                  onChange={(e) => setLateReason(e.target.value)}
                  placeholder="e.g. Store was closed for stocktake in the first week"
                />
                <Button onClick={handleRequestLateAccess} disabled={requestingLate}>
                  {requestingLate ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Request late upload access
                </Button>
              </CardContent>
            </Card>
          )}

          {ctx.periodStatus === 'LATE_REQUESTED' && ctx.pendingLateRequest && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertTitle>Waiting on Admin</AlertTitle>
              <AlertDescription>
                Requested {new Date(ctx.pendingLateRequest.requestedAt).toLocaleString()}
                {ctx.pendingLateRequest.reason ? ` — "${ctx.pendingLateRequest.reason}"` : ''}. You&apos;ll be able to upload as soon as this is approved.
              </AlertDescription>
            </Alert>
          )}

          {ctx.periodStatus === 'LATE_DENIED' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                  <XCircle className="w-4 h-4" /> Late-access request denied
                </CardTitle>
                <CardDescription>
                  {ctx.lastLateRequest?.adminNote || 'No reason given.'} You can file a new request below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={lateReason}
                  onChange={(e) => setLateReason(e.target.value)}
                  placeholder="What's changed since the last request?"
                />
                <Button onClick={handleRequestLateAccess} disabled={requestingLate}>
                  {requestingLate ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Request again
                </Button>
              </CardContent>
            </Card>
          )}

          {(ctx.periodStatus === 'CLOSED' || ctx.periodStatus === 'CLOSED_LATE') && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Already submitted</AlertTitle>
              <AlertDescription>
                This period is closed{ctx.periodStatus === 'CLOSED_LATE' ? ' (submitted late)' : ''}. Contact Admin if you need a correction.
              </AlertDescription>
            </Alert>
          )}

          {/* Upload flow — only when writable */}
          {ctx.isWritable && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Download the sheet</CardTitle>
                <CardDescription>Pre-filled with ECode and Name for cross-checking. Choose how you want to enter overtime.</CardDescription>
              </CardHeader>
              <CardContent className="flex items-end gap-4 flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-gray-500">Overtime entry</Label>
                  <Select value={otMode} onValueChange={(v) => setOtMode(v as 'daily' | 'total')}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="total">One monthly total</SelectItem>
                      <SelectItem value="daily">Day-by-day (reconcile vs device)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" onClick={handleDownloadTemplate}>
                  <Download className="w-4 h-4 mr-2" /> Download template
                </Button>
              </CardContent>
            </Card>
          )}

          {ctx.isWritable && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Upload the filled sheet</CardTitle>
                <CardDescription>We&apos;ll check it for issues before anything is saved.</CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelected}
                  disabled={uploading}
                  className="text-sm"
                />
                {uploading && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 mt-3">
                    <Loader2 className="w-4 h-4 animate-spin" /> Checking file…
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Preview / issues */}
          {preview && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-base">{preview.fileName}</CardTitle>
                    <CardDescription>
                      {preview.rowCount} row(s) · {preview.errorCount} error(s) · {preview.warningCount} warning(s)
                    </CardDescription>
                  </div>
                  <Button onClick={handleCommit} disabled={!preview.canCommit || committing}>
                    {committing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                    Submit
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {preview.issues.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400">No issues found.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Row</TableHead>
                        <TableHead className="w-28">ECode</TableHead>
                        <TableHead className="w-16">Day</TableHead>
                        <TableHead className="w-24">Severity</TableHead>
                        <TableHead>Issue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.issues.map((issue, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-gray-500">{issue.rowIndex}</TableCell>
                          <TableCell className="font-mono text-xs">{issue.staffCode ?? '—'}</TableCell>
                          <TableCell className="text-xs">{issue.day ?? '—'}</TableCell>
                          <TableCell>
                            {issue.severity === 'error' ? (
                              <Badge variant="outline" className="text-xs gap-1 bg-red-50 text-red-700 border-red-200">
                                <XCircle className="w-3 h-3" /> Error
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-200">
                                <AlertTriangle className="w-3 h-3" /> Warning
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{issue.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
