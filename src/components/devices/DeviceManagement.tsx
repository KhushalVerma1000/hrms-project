'use client';

import { useState, useEffect } from 'react';
import {
  getDevicesAction,
  addDeviceAction,
  deleteDeviceAction,
  clearDeviceLogsAction,
  testSmartOfficeConnectionAction,
} from '@/app/(app)/devices/actions';
import { getStoresForOnboardingAction } from '@/app/(app)/onboarding/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Smartphone, Plus, Trash2, Eraser, RefreshCw, Loader2, Signal, SignalZero, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';

export function DeviceManagement({ userRole }: { userRole: string }) {
  const [devices, setDevices] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Connection test state
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<any>(null);

  // Add Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [storeId, setStoreId] = useState('');
  const [model, setModel] = useState('');
  const [adding, setAdding] = useState(false);

  // Maintenance modal
  const [selectedDevice, setSelectedDevice] = useState<any | null>(null);
  const [actionType, setActionType] = useState<'DELETE' | 'CLEAR_LOGS'>('DELETE');
  const [executing, setExecuting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [devs, stData] = await Promise.all([
        getDevicesAction(),
        getStoresForOnboardingAction(),
      ]);
      setDevices(devs);
      setStores(stData as any);
    } catch (err: any) {
      toast.error('Failed to load biometric devices: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const res = await testSmartOfficeConnectionAction();
      setConnectionResult(res);
      if (res.ok) {
        toast.success('SmartOffice connection OK');
      } else {
        toast.error('SmartOffice connection issue — see details below');
      }
    } catch (err: any) {
      setConnectionResult({ ok: false, message: err.message });
      toast.error('Connection test failed to run');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleAddDevice = async () => {
    setAdding(true);
    try {
      const res = await addDeviceAction({
        serialNumber,
        name: deviceName,
        storeId,
        model,
      });
      if (!res.ok) {
        toast.error(res.error || 'Failed to add device');
        return;
      }
      toast.success(`Biometric device ${serialNumber} added and enqueued for sync.`);
      setShowAddModal(false);
      setSerialNumber('');
      setDeviceName('');
      setModel('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Error adding device');
    } finally {
      setAdding(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!selectedDevice) return;
    setExecuting(true);
    try {
      if (actionType === 'DELETE') {
        const res = await deleteDeviceAction(selectedDevice.id);
        if (!res.ok) {
          // Display SmartOffice error verbatim (Section 8 of spec)
          toast.error(res.error || 'Device deletion failed');
          return;
        }
        toast.success(`Device ${selectedDevice.serialNumber} removed.`);
      } else {
        const res = await clearDeviceLogsAction(selectedDevice.id);
        if (!res.ok) {
          toast.error(res.error || 'Failed to clear device logs');
          return;
        }
        toast.success(res.message || 'Device logs cleared.');
      }
      setSelectedDevice(null);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Biometric Devices</h1>
          <p className="text-sm text-gray-500">
            Monitor device health, online pings, user counts, and handle SmartOffice device commands.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {userRole === 'ADMIN' && (
            <Button variant="outline" onClick={handleTestConnection} disabled={testingConnection}>
              {testingConnection ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4 mr-2" />
              )}
              Test SmartOffice Connection
            </Button>
          )}
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-2" /> Register Device
          </Button>
        </div>
      </div>

      {connectionResult && (
        <Card className={connectionResult.ok ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}>
          <CardContent className="p-4 flex items-start gap-3">
            {connectionResult.ok ? (
              <Wifi className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            )}
            <div className="text-sm space-y-1">
              <p className={connectionResult.ok ? 'text-green-800 font-medium' : 'text-red-800 font-medium'}>
                {connectionResult.message}
              </p>
              {!connectionResult.ok && (
                <div className="text-xs text-gray-600 space-y-0.5 mt-1">
                  <p>Base URL configured: {connectionResult.baseUrlConfigured ? 'Yes' : 'No — check SMARTOFFICE_BASE_URL'}</p>
                  <p>API key configured: {connectionResult.apiKeyConfigured ? 'Yes' : 'No — check SMARTOFFICE_API_KEY'}</p>
                  {connectionResult.baseUrlConfigured && connectionResult.apiKeyConfigured && (
                    <>
                      <p>Server reachable: {connectionResult.reachable ? 'Yes' : 'No — network/firewall/DNS issue'}</p>
                      {connectionResult.reachable && (
                        <p>API key valid: {connectionResult.apiKeyValid ? 'Yes' : 'No — key was rejected by SmartOffice'}</p>
                      )}
                    </>
                  )}
                </div>
              )}
              {connectionResult.latencyMs !== null && (
                <p className="text-xs text-gray-500">Response time: {connectionResult.latencyMs}ms</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                <TableHead>Serial Number</TableHead>
                <TableHead>Device Name & Model</TableHead>
                <TableHead>Assigned Store Site</TableHead>
                <TableHead>Health Status</TableHead>
                <TableHead>Users Enrolled</TableHead>
                <TableHead>Logs Count</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading devices...
                  </TableCell>
                </TableRow>
              ) : devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                    No biometric devices registered yet. Click &quot;Register Device&quot; to onboard one.
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((dev) => (
                  <TableRow key={dev.id}>
                    <TableCell className="font-mono font-bold">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-primary" />
                        <span>{dev.serialNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-gray-900 dark:text-white">{dev.name}</div>
                      <div className="text-xs text-gray-500">{dev.model || 'Standard Face/Finger'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{dev.store.name}</div>
                      <div className="text-xs text-gray-500">
                        {dev.store.client.shortName} &bull; {dev.store.warehouseType.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      {dev.isOnline ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs gap-1">
                          <Signal className="w-3 h-3 text-emerald-600" /> Online
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500 text-xs gap-1">
                          <SignalZero className="w-3 h-3 text-gray-400" /> Offline
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{dev.userCount ?? '-'}</TableCell>
                    <TableCell className="font-mono text-sm">{dev.attLogsCount ?? '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {userRole === 'ADMIN' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Clear All Logs"
                            onClick={() => {
                              setSelectedDevice(dev);
                              setActionType('CLEAR_LOGS');
                            }}
                          >
                            <Eraser className="w-4 h-4 text-amber-600" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete Device"
                          onClick={() => {
                            setSelectedDevice(dev);
                            setActionType('DELETE');
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ADD DEVICE MODAL */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Biometric Device</DialogTitle>
            <DialogDescription>
              Add a biometric scanner by Serial Number. Enqueues an AddBiometric command to SmartOffice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Device Serial Number *</Label>
              <Input
                placeholder="e.g. AFK9200481"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Device Name *</Label>
              <Input
                placeholder="e.g. Saket Gate 1 Scanner"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Assigned Store Site *</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.client.shortName} / {s.warehouseType.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Device Model (Optional)</Label>
              <Input
                placeholder="e.g. SpeedFace-V5L"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddDevice} disabled={adding}>
              {adding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : 'Register Device'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONFIRMATION MODAL */}
      <Dialog open={!!selectedDevice} onOpenChange={(open) => !open && setSelectedDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={actionType === 'DELETE' ? 'text-red-600' : 'text-amber-600'}>
              {actionType === 'DELETE' ? 'Delete Device Registration' : 'Clear Device Attendance Logs'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'DELETE'
                ? `Remove device ${selectedDevice?.serialNumber} (${selectedDevice?.name}). If attendance logs exist on SmartOffice, SmartOffice will reject this delete.`
                : `Wipe all attendance logs directly from device ${selectedDevice?.serialNumber}. This action is irreversible.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDevice(null)}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'DELETE' ? 'destructive' : 'default'}
              onClick={handleConfirmAction}
              disabled={executing}
            >
              {executing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : actionType === 'DELETE' ? (
                'Delete Device'
              ) : (
                'Clear Logs'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
