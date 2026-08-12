'use client';

import { useState, useEffect } from 'react';
import { Role } from '@prisma/client';
import { getUsersAction, createUserAction } from '@/app/(app)/users/actions';
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
import { Shield, UserPlus, RefreshCw, Loader2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

export function UserManagement({ currentUserRole }: { currentUserRole: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Create Modal
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(
    currentUserRole === 'ADMIN' ? 'CLIENT' : currentUserRole === 'CLIENT' ? 'MANAGER' : 'PROCESS_ASSOCIATE',
  );
  const [storeId, setStoreId] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  // Result password modal
  const [createdInfo, setCreatedInfo] = useState<{ email: string; tempPass: string } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [uData, stData] = await Promise.all([getUsersAction(), getStoresForOnboardingAction()]);
      setUsers(uData);
      setStores(stData as any);
    } catch (err: any) {
      toast.error('Failed to load user management data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateUser = async () => {
    setCreating(true);
    try {
      const res = await createUserAction({
        name,
        email,
        role,
        storeId: storeId || undefined,
        password: password || undefined,
      });

      if (!res.ok) {
        toast.error(res.error || 'Failed to create user');
        return;
      }

      setCreatedInfo({ email: res.user!.email, tempPass: res.tempPassword! });
      setShowModal(false);
      setName('');
      setEmail('');
      setPassword('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Error creating user');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User & Access Management</h1>
          <p className="text-sm text-gray-500">
            Manage platform logins, roles, and permissions according to the role hierarchy matrix.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => setShowModal(true)}>
            <UserPlus className="w-4 h-4 mr-2" /> Add App User
          </Button>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                <TableHead>User Name</TableHead>
                <TableHead>Email Login</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Scope / Store</TableHead>
                <TableHead>Linked Associate</TableHead>
                <TableHead>Must Reset Pass</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading app users...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-semibold text-gray-900 dark:text-white">{u.name}</TableCell>
                    <TableCell className="font-mono text-sm">{u.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          u.role === 'ADMIN'
                            ? 'destructive'
                            : u.role === 'CLIENT'
                            ? 'default'
                            : u.role === 'MANAGER'
                            ? 'secondary'
                            : 'outline'
                        }
                        className="text-xs"
                      >
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.store ? (
                        <div className="text-sm">
                          <span className="font-medium">{u.store.name}</span>
                          <span className="text-xs text-gray-500 block">{u.store.warehouseType.name}</span>
                        </div>
                      ) : u.client ? (
                        <span className="text-sm font-medium">{u.client.name} (Client)</span>
                      ) : (
                        <span className="text-xs text-gray-400">Global (Admin)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.employee ? (
                        <Badge variant="outline" className="text-xs font-mono">
                          {u.employee.staffCode} ({u.employee.name})
                        </Badge>
                      ) : (
                        <span className="text-xs text-gray-400">None</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.mustChangePassword ? (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-xs">
                          Yes
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-400 text-xs">
                          No
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CREATE USER MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create App User Account</DialogTitle>
            <DialogDescription>
              Grants app access based on role scope. Associates & Quality Associates cannot be assigned app logins.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input placeholder="e.g. Anil Kumar" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Email Address *</Label>
              <Input type="email" placeholder="user@warehouse.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>App Role *</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currentUserRole === 'ADMIN' && <SelectItem value="CLIENT">Client Account Admin</SelectItem>}
                  {(currentUserRole === 'ADMIN' || currentUserRole === 'CLIENT') && (
                    <SelectItem value="MANAGER">Store Manager</SelectItem>
                  )}
                  <SelectItem value="PROCESS_ASSOCIATE">Process Associate</SelectItem>
                  <SelectItem value="SHIFT_INCHARGE">Shift Incharge</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(role === 'MANAGER' || role === 'PROCESS_ASSOCIATE' || role === 'SHIFT_INCHARGE') && (
              <div className="space-y-2">
                <Label>Assigned Store *</Label>
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
            )}

            <div className="space-y-2">
              <Label>Initial Password (Optional)</Label>
              <Input
                type="text"
                placeholder="Leave blank to auto-generate"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : 'Create User Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PASSWORD DISPLAY MODAL */}
      <Dialog open={!!createdInfo} onOpenChange={(open) => !open && setCreatedInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <KeyRound className="w-5 h-5" /> Account Created Successfully
            </DialogTitle>
            <DialogDescription>
              Share these login credentials with the user. They will be forced to change password on first login.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border space-y-2 font-mono text-sm">
            <div>
              <span className="text-gray-500 text-xs block">Email:</span>
              <span className="font-bold">{createdInfo?.email}</span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">Temporary Password:</span>
              <span className="font-bold text-primary">{createdInfo?.tempPass}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(`Email: ${createdInfo?.email}\nPassword: ${createdInfo?.tempPass}`);
                toast.success('Credentials copied to clipboard!');
                setCreatedInfo(null);
              }}
            >
              Copy & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
