'use client';

import { useState, useEffect } from 'react';
import { CommandStatus } from '@prisma/client';
import { getCommandsAction, retryFailedCommandAction } from '@/app/(app)/sync-issues/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, RotateCcw, AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

export function SyncIssuesPanel({ userRole }: { userRole: string }) {
  const [commands, setCommands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('FAILED');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getCommandsAction(
        statusFilter !== 'ALL' ? (statusFilter as CommandStatus) : undefined,
      );
      setCommands(data);
    } catch (err: any) {
      toast.error('Failed to load command queue: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const handleRetry = async (cmdId: string) => {
    setRetryingId(cmdId);
    try {
      const res = await retryFailedCommandAction(cmdId);
      if (!res.ok) {
        toast.error(res.error || 'Retry failed');
        return;
      }
      toast.success('Command reset to PENDING. Worker will dispatch on next poll.');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Error triggering command retry');
    } finally {
      setRetryingId(null);
    }
  };

  const failedCount = commands.filter((c) => c.status === 'FAILED').length;
  const pendingCount = commands.filter((c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-amber-500" /> Outbound SmartOffice Sync Issues
          </h1>
          <p className="text-sm text-gray-500">
            Monitor background API command queue status, inspect SmartOffice error messages, and trigger manual retries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh Status
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-red-700 dark:text-red-300">Terminal Failed Commands</CardDescription>
            <CardTitle className="text-2xl text-red-900 dark:text-red-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" /> {failedCount}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-amber-700 dark:text-amber-300">In Queue / Retrying</CardDescription>
            <CardTitle className="text-2xl text-amber-900 dark:text-amber-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" /> {pendingCount}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs text-gray-500">Max Retry Schedule</CardDescription>
            <CardTitle className="text-lg font-mono text-gray-800 dark:text-gray-200">
              6 Attempts (17h Max)
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Commands Table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Command Queue Log</CardTitle>
            <CardDescription>All outbound write commands queued for SmartOffice API.</CardDescription>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] text-sm">
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="FAILED">FAILED Only</SelectItem>
              <SelectItem value="PENDING">PENDING Only</SelectItem>
              <SelectItem value="IN_PROGRESS">IN_PROGRESS Only</SelectItem>
              <SelectItem value="SUCCEEDED">SUCCEEDED Only</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                <TableHead>Command Type</TableHead>
                <TableHead>Idempotency Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>SmartOffice API Error</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading command queue...
                  </TableCell>
                </TableRow>
              ) : commands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                    No commands found matching status &quot;{statusFilter}&quot;.
                  </TableCell>
                </TableRow>
              ) : (
                commands.map((cmd) => (
                  <TableRow key={cmd.id}>
                    <TableCell className="font-mono font-bold text-sm">
                      <Badge variant="outline" className="font-mono">
                        {cmd.commandType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-600 dark:text-gray-400">
                      {cmd.idempotencyKey}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          cmd.status === 'SUCCEEDED'
                            ? 'default'
                            : cmd.status === 'FAILED'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className="text-xs font-mono"
                      >
                        {cmd.status === 'PENDING' && <Loader2 className="w-3 h-3 animate-spin mr-1 inline" />}
                        {cmd.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {cmd.attempts} / {cmd.maxAttempts}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-red-600 font-mono">
                      {cmd.lastError ? cmd.lastError : <span className="text-gray-400">-</span>}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500 font-mono">
                      {new Date(cmd.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {cmd.status === 'FAILED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(cmd.id)}
                          disabled={retryingId === cmd.id}
                        >
                          {retryingId === cmd.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          )}
                          Retry Now
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
