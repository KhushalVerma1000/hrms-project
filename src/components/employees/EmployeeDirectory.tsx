'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { EmployeeStatus, Designation } from '@prisma/client';
import {
  getEmployeesPageAction,
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
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Search,
  Edit,
  Trash2,
  UserX,
  Shield,
  AlertTriangle,
  Loader2,
  RefreshCw,
  UserPlus,
  X,
  Phone,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { normalizeMobile, formatMobile } from '@/lib/whatsapp';

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
  mobileNumber: string | null;
  canEdit: boolean;
  onboardingFormStatus: string;
  createdAt: Date | string;
  store: {
    name: string;
    client: { shortName: string; name: string };
    warehouseType: { name: string };
  };
  linkedUser: { id: string; email: string; role: string } | null;
}

interface PageData {
  employees: EmployeeRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stores: { id: string; name: string; clientId: string; client: { shortName: string } }[];
  clients: { id: string; name: string; shortName: string }[];
}

const DESIGNATION_LABELS: Record<string, string> = {
  ASSOCIATE: 'Associate',
  PROCESS_ASSOCIATE: 'Process Associate',
  QUALITY_ASSOCIATE: 'Quality Associate',
  SHIFT_INCHARGE: 'Shift Incharge',
  STORE_MANAGER: 'Store Manager',
  HOUSEKEEPING: 'Housekeeping',
  OTHER: 'Other',
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function EmployeeDirectory({ userRole }: { userRole: string }) {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true); // true on every fetch
  const requestId = useRef(0); // ignore out-of-order responses

  // Filters (search is debounced so typing doesn't fire a request per key)
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [formFilter, setFormFilter] = useState('ALL');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [storeFilter, setStoreFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Edit Modal State
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [editCard, setEditCard] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editTeam, setEditTeam] = useState('');
  const [updating, setUpdating] = useState(false);

  // Delete Modal State
  const [deletingEmployee, setDeletingEmployee] = useState<EmployeeRecord | null>(null);
  const [deleteType, setDeleteType] = useState<'SOFT' | 'HARD'>('SOFT');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch((prev) => {
        const next = searchInput.trim();
        if (next !== prev) setPage(1);
        return next;
      });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchEmployees = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await getEmployeesPageAction({
        page,
        pageSize,
        search: search || undefined,
        status: statusFilter !== 'ALL' ? (statusFilter as EmployeeStatus) : undefined,
        designation: designationFilter !== 'ALL' ? designationFilter : undefined,
        formStatus: formFilter !== 'ALL' ? (formFilter as 'NOT_SENT' | 'PENDING' | 'SUBMITTED') : undefined,
        clientId: clientFilter !== 'ALL' ? clientFilter : undefined,
        storeId: storeFilter !== 'ALL' ? storeFilter : undefined,
      });
      if (id !== requestId.current) return;
      setData(res as unknown as PageData);
      if (res.page !== page) setPage(res.page); // page was past the end after a delete/filter
    } catch (err: any) {
      if (id === requestId.current) toast.error('Failed to load employee directory: ' + err.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, designationFilter, formFilter, clientFilter, storeFilter]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Any filter change goes back to page 1.
  const changeFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };
  const changeClient = (v: string) => {
    setClientFilter(v);
    setStoreFilter('ALL'); // the old store may not belong to the new client
    setPage(1);
  };

  const activeFilterCount =
    (search ? 1 : 0) +
    [statusFilter, designationFilter, formFilter, clientFilter, storeFilter].filter((f) => f !== 'ALL').length;

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatusFilter('ALL');
    setDesignationFilter('ALL');
    setFormFilter('ALL');
    setClientFilter('ALL');
    setStoreFilter('ALL');
    setPage(1);
  };

  const employees = data?.employees ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);
  const storeOptions = (data?.stores ?? []).filter((st) => clientFilter === 'ALL' || st.clientId === clientFilter);
  const isAdmin = userRole === 'ADMIN';
  const showStoreFilter = (data?.stores.length ?? 0) > 1;

  const openEditModal = (emp: EmployeeRecord) => {
    setEditingEmployee(emp);
    setEditName(emp.name);
    setEditGender(emp.gender || 'Male');
    setEditMobile(emp.mobileNumber ? formatMobile(emp.mobileNumber) : '');
    setEditCard(emp.cardNumber || '');
    setEditGrade(emp.grade || '');
    setEditTeam(emp.team || '');
  };

  const editMobileInvalid = editMobile.trim() !== '' && normalizeMobile(editMobile) === null;

  const handleSaveEdit = async () => {
    if (!editingEmployee || editMobileInvalid) return;
    setUpdating(true);
    try {
      const res = await updateEmployeeAction(editingEmployee.id, {
        name: editName,
        gender: editGender,
        mobileNumber: editMobile,
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Employee Directory
            {data && (
              <Badge variant="secondary" className="text-xs font-medium">
                <Users className="w-3 h-3 mr-1" /> {total.toLocaleString()}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-gray-500">
            Search, filter and manage warehouse associates across stores.
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

      {/* Filter Bar — applies as you type / pick, no Filter button needed */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name, e-code, card or mobile number..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-9 text-sm"
              aria-label="Search employees"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {isAdmin && (
              <Select value={clientFilter} onValueChange={changeClient}>
                <SelectTrigger className="text-sm" aria-label="Filter by client">
                  <SelectValue placeholder="Client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Clients</SelectItem>
                  {(data?.clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {showStoreFilter && (
              <Select value={storeFilter} onValueChange={changeFilter(setStoreFilter)}>
                <SelectTrigger className="text-sm" aria-label="Filter by store">
                  <SelectValue placeholder="Store" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Stores</SelectItem>
                  {storeOptions.map((st) => (
                    <SelectItem key={st.id} value={st.id}>
                      {st.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={designationFilter} onValueChange={changeFilter(setDesignationFilter)}>
              <SelectTrigger className="text-sm" aria-label="Filter by designation">
                <SelectValue placeholder="Designation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Designations</SelectItem>
                {Object.entries(DESIGNATION_LABELS)
                  .filter(([k]) => k !== 'OTHER')
                  .map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={changeFilter(setStatusFilter)}>
              <SelectTrigger className="text-sm" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="OFFBOARDED">Offboarded / Suspended</SelectItem>
              </SelectContent>
            </Select>

            <Select value={formFilter} onValueChange={changeFilter(setFormFilter)}>
              <SelectTrigger className="text-sm" aria-label="Filter by paperwork form">
                <SelectValue placeholder="Paperwork" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any Paperwork</SelectItem>
                <SelectItem value="NOT_SENT">Form not sent</SelectItem>
                <SelectItem value="PENDING">Form pending</SelectItem>
                <SelectItem value="SUBMITTED">Form submitted</SelectItem>
              </SelectContent>
            </Select>

            {activeFilterCount > 0 && (
              <Button variant="ghost" onClick={clearFilters} className="text-sm justify-start lg:justify-center">
                <X className="w-4 h-4 mr-1" /> Clear filters ({activeFilterCount})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Employee Directory Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <div className={`h-0.5 bg-primary/70 transition-opacity ${loading ? 'opacity-100 animate-pulse' : 'opacity-0'}`} />
          <Table className={loading && data ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <TableHeader>
              <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                <TableHead className="font-semibold">Employee</TableHead>
                <TableHead className="font-semibold">Contact</TableHead>
                <TableHead className="font-semibold">Store & Brand</TableHead>
                <TableHead className="font-semibold">Designation</TableHead>
                <TableHead className="font-semibold">App Access</TableHead>
                <TableHead className="font-semibold">Paperwork</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="text-right font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading employees...
                  </TableCell>
                </TableRow>
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <div className="font-medium text-gray-700 dark:text-gray-200">
                      {activeFilterCount > 0 ? 'No employees match these filters' : 'No employees yet'}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {activeFilterCount > 0
                        ? 'Try removing a filter or checking the spelling of your search.'
                        : 'Onboard your first associate to see them here.'}
                    </div>
                    {activeFilterCount > 0 && (
                      <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                        <X className="w-4 h-4 mr-1" /> Clear filters
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                employees.map((emp) => (
                  <TableRow key={emp.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/50">
                    <TableCell>
                      <div className="font-semibold text-gray-900 dark:text-white">{emp.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span className="font-mono">{emp.staffCode}</span>
                        {emp.isLegacyCode && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 text-amber-700 bg-amber-50">
                            Legacy
                          </Badge>
                        )}
                        {emp.gender && <span>&bull; {emp.gender}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {emp.mobileNumber ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm tabular-nums">{formatMobile(emp.mobileNumber)}</span>
                          <a
                            href={`tel:+${emp.mobileNumber}`}
                            title="Call"
                            aria-label={`Call ${emp.name}`}
                            className="text-gray-400 hover:text-gray-700"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                          <a
                            href={`https://wa.me/${emp.mobileNumber}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open WhatsApp chat"
                            aria-label={`WhatsApp ${emp.name}`}
                            className="text-green-600 hover:text-green-700"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ) : emp.canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-amber-700 hover:text-amber-800"
                          onClick={() => openEditModal(emp)}
                        >
                          + Add number
                        </Button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{emp.store.name}</div>
                      <div className="text-xs text-gray-500">
                        {emp.store.client.shortName} &bull; {emp.store.warehouseType.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs whitespace-nowrap">
                        {DESIGNATION_LABELS[emp.designation] ?? emp.designation}
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
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">Submitted</Badge>
                      ) : emp.onboardingFormStatus === 'PENDING' ? (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-xs">
                          Pending
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
                        <Button variant="ghost" size="icon" title="Edit" aria-label={`Edit ${emp.name}`} onClick={() => openEditModal(emp)}>
                          <Edit className="w-4 h-4 text-gray-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Deactivate"
                          aria-label={`Deactivate ${emp.name}`}
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
                          aria-label={`Permanently delete ${emp.name}`}
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

        {/* Pagination */}
        {data && total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t px-4 py-3 text-sm">
            <div className="text-gray-500">
              Showing <span className="font-medium text-gray-900 dark:text-white">{firstShown}–{lastShown}</span> of{' '}
              <span className="font-medium text-gray-900 dark:text-white">{total.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 hidden sm:inline">Rows</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[72px] text-sm" aria-label="Rows per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={page <= 1 || loading} aria-label="First page">
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} aria-label="Previous page">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 text-gray-600 dark:text-gray-300 tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} aria-label="Next page">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)} disabled={page >= totalPages || loading} aria-label="Last page">
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
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
              <Label htmlFor="editMobile">Mobile Number (WhatsApp)</Label>
              <Input
                id="editMobile"
                type="tel"
                inputMode="tel"
                value={editMobile}
                onChange={(e) => setEditMobile(e.target.value)}
                placeholder="e.g. 98765 43210"
                aria-invalid={editMobileInvalid}
                className={editMobileInvalid ? 'border-red-400 focus-visible:ring-red-400' : ''}
              />
              {editMobileInvalid ? (
                <p className="text-xs text-red-600">Enter 10 digits, or a number with country code.</p>
              ) : (
                <p className="text-xs text-gray-500">Leave empty to remove the number.</p>
              )}
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
            <Button onClick={handleSaveEdit} disabled={updating || editMobileInvalid || !editName.trim()}>
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
