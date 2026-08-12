'use client';

import { useState, useEffect } from 'react';
import { EmployeeStatus, Designation } from '@prisma/client';
import {
  getEmployeesAction,
  updateEmployeeAction,
  softDeleteEmployeeAction,
  hardDeleteEmployeeAction,
} from '@/app/(app)/employees/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Search, Filter, Edit, Trash2, UserX, Shield, AlertTriangle, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

interface EmployeeRecord {
  id: string;
  staffCode: string;
  isLegacyCode: boolean;
  name: string;
  gender: string | null;
  status: EmployeeStatus;
  designation: Designation;
  grade: string | null;
  team: string | null;
  cardNumber: string | null;
  onboardingFormStatus: string;
  createdAt: Date | string;
  store: {
    name: string;
    client: { shortName: string; name: string };
    warehouseType: { name: string };
  };
  linkedUser: { id: string; email: string; role: string } | null;
}

export function EmployeeDirectory({ userRole }: { userRole: string }) {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [designationFilter, setDesignationFilter] = useState<string>('ALL');

  // Edit Modal State
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState('');
  const [editCard, setEditCard] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editTeam, setEditTeam] = useState('');
  const [updating, setUpdating] = useState(false);

  // Delete Modal State
  const [deletingEmployee, setDeletingEmployee] = useState<EmployeeRecord | null>(null);
  const [deleteType, setDeleteType] = useState<'SOFT' | 'HARD'>('SOFT');
  const [deleting, setDeleting] = useState(false);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const data = await getEmployeesAction({
        search: search || undefined,
        status: statusFilter !== 'ALL' ? (statusFilter as EmployeeStatus) : undefined,
        designation: designationFilter !== 'ALL' ? designationFilter : undefined,
      });
      setEmployees(data as any);
    } catch (err: any) {
      toast.error('Failed to load employee directory: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [statusFilter, designationFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEmployees();
  };

  const openEditModal = (emp: EmployeeRecord) => {
    setEditingEmployee(emp);
    setEditName(emp.name);
    setEditGender(emp.gender || 'Male');
    setEditCard(emp.cardNumber || '');
    setEditGrade(emp.grade || '');
    setEditTeam(emp.team || '');
  };

  const handleSaveEdit = async () => {
    if (!editingEmployee) return;
    setUpdating(true);
    try {
      const res = await updateEmployeeAction(editingEmployee.id, {
        name: editName,
        gender: editGender,
        cardNumber: editCard,
        grade: editGrade,
        team: editTeam,
      });
      if (!res.ok) {
        toast.error(res.error || 'Failed to update employee');
        return;
      }
      toast.success('Employee details updated');
      setEditingEmployee(null);
      fetchEmployees();
    } catch (err: any) {
      toast.error(err.message || 'Error updating employee');
    } finally {
      setUpdating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingEmployee) return;
    setDeleting(true);
    try {
      if (deleteType === 'SOFT') {
        const res = await softDeleteEmployeeAction(deletingEmployee.id);
        if (!res.ok) {
          toast.error(res.error || 'Deactivation failed');
          return;
        }
        toast.success(`Employee ${deletingEmployee.staffCode} deactivated.`);
      } else {
        const res = await hardDeleteEmployeeAction(deletingEmployee.id);
        if (!res.ok) {
          toast.error(res.error || 'Hard delete failed');
          return;
        }
        toast.success(`Employee ${deletingEmployee.staffCode} permanently removed.`);
      }
      setDeletingEmployee(null);
      fetchEmployees();
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Employee Directory</h1>
          <p className="text-sm text-gray-500">
            View, search, edit, and manage warehouse associates across stores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchEmployees} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button asChild>
            <a href="/onboarding">
              <UserPlus className="w-4 h-4 mr-2" /> Onboard New
            </a>
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search name, e-code, card..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="OFFBOARDED">Offboarded / Suspended</SelectItem>
              </SelectContent>
            </Select>

            <Select value={designationFilter} onValueChange={setDesignationFilter}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Designation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Designations</SelectItem>
                <SelectItem value="ASSOCIATE">Associate</SelectItem>
                <SelectItem value="PROCESS_ASSOCIATE">Process Associate</SelectItem>
                <SelectItem value="QUALITY_ASSOCIATE">Quality Associate</SelectItem>
                <SelectItem value="SHIFT_INCHARGE">Shift Incharge</SelectItem>
              </SelectContent>
            </Select>

            <Button type="submit" variant="secondary" className="w-full">
              <Filter className="w-4 h-4 mr-2" /> Filter Results
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Employee Directory Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                <TableHead className="font-semibold">E-Code</TableHead>
                <TableHead className="font-semibold">Name & Gender</TableHead>
                <TableHead className="font-semibold">Store & Brand</TableHead>
                <TableHead className="font-semibold">Designation</TableHead>
                <TableHead className="font-semibold">App Access</TableHead>
                <TableHead className="font-semibold">Paperwork Form</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="text-right font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading employees...
                  </TableCell>
                </TableRow>
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    No employees found matching criteria.
                  </TableCell>
                </TableRow>
              ) : (
                employees.map((emp) => (
                  <TableRow key={emp.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/50">
                    <TableCell className="font-mono font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{emp.staffCode}</span>
                        {emp.isLegacyCode && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 text-amber-700 bg-amber-50">
                            Legacy
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-gray-900 dark:text-white">{emp.name}</div>
                      <div className="text-xs text-gray-500">{emp.gender || 'Not specified'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{emp.store.name}</div>
                      <div className="text-xs text-gray-500">
                        {emp.store.client.shortName} &bull; {emp.store.warehouseType.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {emp.designation.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {emp.linkedUser ? (
                        <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-xs gap-1">
                          <Shield className="w-3 h-3" /> Login Enabled
                        </Badge>
                      ) : (
                        <span className="text-xs text-gray-400">No App Login</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {emp.onboardingFormStatus === 'SUBMITTED' ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
                          Submitted
                        </Badge>
                      ) : emp.onboardingFormStatus === 'PENDING' ? (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-xs">
                          Pending Form
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500 text-xs">
                          Not Sent
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={emp.status === 'ACTIVE' ? 'default' : 'secondary'}
                        className={emp.status === 'ACTIVE' ? 'bg-emerald-600' : 'bg-gray-400'}
                      >
                        {emp.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEditModal(emp)}>
                          <Edit className="w-4 h-4 text-gray-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Deactivate"
                          onClick={() => {
                            setDeletingEmployee(emp);
                            setDeleteType('SOFT');
                          }}
                        >
                          <UserX className="w-4 h-4 text-amber-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Hard Delete"
                          onClick={() => {
                            setDeletingEmployee(emp);
                            setDeleteType('HARD');
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

      {/* Edit Modal */}
      <Dialog open={!!editingEmployee} onOpenChange={(open) => !open && setEditingEmployee(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee Details</DialogTitle>
            <DialogDescription>
              Update basic details for {editingEmployee?.name} ({editingEmployee?.staffCode})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select value={editGender} onValueChange={setEditGender}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Card Number</Label>
              <Input value={editCard} onChange={(e) => setEditCard(e.target.value)} placeholder="Smart card ID" />
            </div>
            <div className="space-y-2">
              <Label>Grade</Label>
              <Input value={editGrade} onChange={(e) => setEditGrade(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Team</Label>
              <Input value={editTeam} onChange={(e) => setEditTeam(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEmployee(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updating}>
              {updating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete / Deactivate Confirmation Modal */}
      <Dialog open={!!deletingEmployee} onOpenChange={(open) => !open && setDeletingEmployee(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={deleteType === 'HARD' ? 'text-red-600' : 'text-amber-600'}>
              {deleteType === 'SOFT' ? 'Deactivate Associate' : 'Hard Delete Employee Record'}
            </DialogTitle>
            <DialogDescription>
              {deleteType === 'SOFT'
                ? `Deactivating ${deletingEmployee?.name} (${deletingEmployee?.staffCode}) marks them as OFFBOARDED.`
                : `Permanently remove ${deletingEmployee?.name} (${deletingEmployee?.staffCode}) from local database and SmartOffice device enrollment.`}
            </DialogDescription>
          </DialogHeader>

          {deleteType === 'HARD' && (
            <Alert variant="destructive" className="bg-red-50 text-red-900 border-red-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Server 30-Day Guard Policy</AlertTitle>
              <AlertDescription className="text-xs">
                Managers can only hard-delete employees with zero attendance records in the last 30 days. If attendance exists within 30 days, only Admin or Client can execute this.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingEmployee(null)}>
              Cancel
            </Button>
            <Button
              variant={deleteType === 'HARD' ? 'destructive' : 'default'}
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : deleteType === 'HARD' ? (
                'Permanently Delete'
              ) : (
                'Deactivate'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
