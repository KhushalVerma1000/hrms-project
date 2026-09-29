'use client';

import { useState, useEffect } from 'react';
import {
  getStoresDataAction,
  createClientAction,
  createWarehouseTypeAction,
  createStoreAction,
  updateClientDetailsAction,
  updateStoreDetailsAction,
  updateStoreFaceAttendanceAction,
} from '@/app/(app)/stores/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Building2, Store, Tag, Plus, Loader2, RefreshCw, MapPin, Pencil, ScanFace } from 'lucide-react';
import { toast } from 'sonner';

export function StoreManagement({ userRole }: { userRole: string }) {
  const [stores, setStores] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [warehouseTypes, setWarehouseTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientShort, setClientShort] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientLocation, setClientLocation] = useState('');
  const [clientGstin, setClientGstin] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);

  const [showBrandModal, setShowBrandModal] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [creatingBrand, setCreatingBrand] = useState(false);

  const [showStoreModal, setShowStoreModal] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [storeClientId, setStoreClientId] = useState('');
  const [storeWarehouseTypeId, setStoreWarehouseTypeId] = useState('');
  const [storeExtCode, setStoreExtCode] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeLocation, setStoreLocation] = useState('');
  const [storeGstin, setStoreGstin] = useState('');
  const [creatingStore, setCreatingStore] = useState(false);

  // Edit-details dialog (shared by stores and clients)
  const [editTarget, setEditTarget] = useState<{
    kind: 'store' | 'client';
    id: string;
    name: string;
    address: string;
    location: string;
    gstin: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getStoresDataAction();
      setStores(data.stores);
      setClients(data.clients);
      setWarehouseTypes(data.warehouseTypes);
      if (data.clients.length === 1) setStoreClientId(data.clients[0].id);
    } catch (err: any) {
      toast.error('Failed to load store management data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateClient = async () => {
    setCreatingClient(true);
    try {
      const res = await createClientAction(clientName, clientShort, clientEmail, undefined, undefined, clientLocation, clientGstin);
      if (!res.ok) {
        toast.error(res.error || 'Failed to create client');
        return;
      }
      toast.success(`Client ${res.client?.name} created with Auto Code: ${res.client?.code}`);
      setShowClientModal(false);
      setClientName('');
      setClientShort('');
      setClientEmail('');
      setClientLocation('');
      setClientGstin('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingClient(false);
    }
  };

  const handleCreateBrand = async () => {
    setCreatingBrand(true);
    try {
      const res = await createWarehouseTypeAction(brandName);
      if (!res.ok) {
        toast.error(res.error || 'Failed to create brand');
        return;
      }
      toast.success(`Warehouse Brand ${res.warehouseType?.name} created with Auto Code: ${res.warehouseType?.code}`);
      setShowBrandModal(false);
      setBrandName('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingBrand(false);
    }
  };

  const handleCreateStore = async () => {
    setCreatingStore(true);
    try {
      const res = await createStoreAction({
        name: storeName,
        clientId: storeClientId,
        warehouseTypeId: storeWarehouseTypeId,
        externalStoreCode: storeExtCode,
        address: storeAddress,
        location: storeLocation,
        gstin: storeGstin,
      });
      if (!res.ok) {
        toast.error(res.error || 'Failed to create store');
        return;
      }
      toast.success(userRole === 'ADMIN' ? `Store ${res.store?.name} created with Auto 2-Digit Code: ${res.store?.code}` : `Store ${res.store?.name} created`);
      setShowStoreModal(false);
      setStoreName('');
      setStoreExtCode('');
      setStoreAddress('');
      setStoreLocation('');
      setStoreGstin('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingStore(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      const res =
        editTarget.kind === 'store'
          ? await updateStoreDetailsAction(editTarget.id, {
              address: editTarget.address,
              location: editTarget.location,
              gstin: editTarget.gstin,
            })
          : await updateClientDetailsAction(editTarget.id, {
              location: editTarget.location,
              gstin: editTarget.gstin,
            });
      if (!res.ok) {
        toast.error(res.error || 'Failed to save changes');
        return;
      }
      toast.success('Details saved');
      setEditTarget(null);
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const [faceTogglingId, setFaceTogglingId] = useState<string | null>(null);

  const toggleFaceAttendance = async (st: any) => {
    const enable = !st.faceAttendanceEnabled;
    if (
      enable &&
      !window.confirm(
        `Turn on face attendance for ${st.name}? Employees must consent before their face is enrolled.`,
      )
    ) {
      return;
    }
    setFaceTogglingId(st.id);
    const res = await updateStoreFaceAttendanceAction(st.id, enable);
    setFaceTogglingId(null);
    if (res.ok) {
      setStores((prev) => prev.map((x) => (x.id === st.id ? { ...x, faceAttendanceEnabled: enable } : x)));
      toast.success(`Face attendance ${enable ? 'enabled' : 'disabled'} for ${st.name}`);
    } else {
      toast.error(res.error ?? 'Could not update.');
    }
  };

  const colCount = userRole === 'ADMIN' ? 11 : 9;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Store & Account Structure</h1>
          <p className="text-sm text-gray-500">
            Manage staffing vendor Clients, Warehouse Brands, and Store sites with auto-assigned codes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {userRole === 'ADMIN' && (
            <>
              <Button variant="outline" onClick={() => setShowClientModal(true)}>
                <Building2 className="w-4 h-4 mr-2" /> Add Client
              </Button>
              <Button variant="outline" onClick={() => setShowBrandModal(true)}>
                <Tag className="w-4 h-4 mr-2" /> Add Brand
              </Button>
            </>
          )}
          <Button onClick={() => setShowStoreModal(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Store
          </Button>
        </div>
      </div>

      <Tabs defaultValue="stores" className="w-full">
        <TabsList>
          <TabsTrigger value="stores">
            <Store className="w-4 h-4 mr-2" /> Physical Stores ({stores.length})
          </TabsTrigger>
          <TabsTrigger value="clients">
            <Building2 className="w-4 h-4 mr-2" />{' '}
            {userRole === 'ADMIN' ? `Staffing Clients (${clients.length})` : 'Your Company'}
          </TabsTrigger>
          {userRole === 'ADMIN' && (
            <TabsTrigger value="brands">
              <Tag className="w-4 h-4 mr-2" /> Warehouse Brands ({warehouseTypes.length})
            </TabsTrigger>
          )}
        </TabsList>

        {/* STORES TAB */}
        <TabsContent value="stores" className="mt-4">
          <Card className="shadow-sm">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                    {userRole === 'ADMIN' && <TableHead>Store Code</TableHead>}
                    <TableHead>Store Name</TableHead>
                    {userRole === 'ADMIN' && <TableHead>Client Account</TableHead>}
                    <TableHead>Warehouse Brand</TableHead>
                    <TableHead>Brand External Code</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>GSTIN</TableHead>
                    <TableHead>Active Employees</TableHead>
                    <TableHead>Biometric Devices</TableHead>
                    <TableHead>Face Attendance</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                                        if (loading) {
                      return (
                        <TableRow>
                          <TableCell colSpan={colCount} className="text-center py-8 text-gray-500">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading stores...
                          </TableCell>
                        </TableRow>
                      );
                    }
                    if (stores.length === 0) {
                      return (
                        <TableRow>
                          <TableCell colSpan={colCount} className="text-center py-8 text-gray-500">
                            No stores registered yet. Click &quot;Add Store&quot; to create one.
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return null;
                  })()}
                  {!loading && stores.length > 0 && (
                    stores.map((st) => (
                      <TableRow key={st.id}>
                        {userRole === 'ADMIN' && (
                          <TableCell className="font-mono font-bold text-primary">
                            <Badge variant="outline" className="font-mono bg-primary/5 text-primary border-primary/20">
                              {st.code}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="font-semibold text-gray-900 dark:text-white">{st.name}</div>
                          {st.address && (
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3" /> {st.address}
                            </div>
                          )}
                        </TableCell>
                        {userRole === 'ADMIN' && (
                          <TableCell>
                            <span className="font-medium text-sm">{st.client.name}</span>
                            <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
                              Code: {st.client.code}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {st.warehouseType.name}
                            {userRole === 'ADMIN' ? ` (Code: ${st.warehouseType.code})` : ''}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {st.externalStoreCode ? st.externalStoreCode : <span className="text-gray-400 text-xs">None</span>}
                        </TableCell>
                        <TableCell className="text-sm">{st.location || <span className="text-gray-400 text-xs">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{st.gstin || <span className="text-gray-400">—</span>}</TableCell>
                        <TableCell className="font-semibold text-sm">{st._count?.employees || 0}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {st.devices?.length || 0} Devices
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant={st.faceAttendanceEnabled ? 'default' : 'outline'}
                            size="sm"
                            disabled={faceTogglingId === st.id}
                            onClick={() => toggleFaceAttendance(st)}
                            aria-label={`Turn face attendance ${st.faceAttendanceEnabled ? 'off' : 'on'} for ${st.name}`}
                          >
                            {faceTogglingId === st.id ? (
                              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            ) : (
                              <ScanFace className="w-3.5 h-3.5 mr-1.5" />
                            )}
                            {st.faceAttendanceEnabled ? 'On' : 'Off'}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${st.name}`}
                            onClick={() =>
                              setEditTarget({
                                kind: 'store',
                                id: st.id,
                                name: st.name,
                                address: st.address || '',
                                location: st.location || '',
                                gstin: st.gstin || '',
                              })
                            }
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CLIENTS TAB */}
        {(
          <TabsContent value="clients" className="mt-4">
            <Card className="shadow-sm">
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                      {userRole === 'ADMIN' && <TableHead>Client Code</TableHead>}
                      <TableHead>{userRole === 'ADMIN' ? 'Vendor Account Name' : 'Company Name'}</TableHead>
                      {userRole === 'ADMIN' && <TableHead>Short Name</TableHead>}
                      <TableHead>Contact Email</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients.map((cl) => (
                      <TableRow key={cl.id}>
                        {userRole === 'ADMIN' && (
                          <TableCell className="font-mono font-bold text-primary">
                            <Badge variant="outline" className="font-mono bg-primary/5 text-primary border-primary/20">
                              {cl.code}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell className="font-semibold text-gray-900 dark:text-white">{cl.name}</TableCell>
                        {userRole === 'ADMIN' && <TableCell className="font-mono text-sm">{cl.shortName}</TableCell>}
                        <TableCell className="text-sm text-gray-500">{cl.email || 'N/A'}</TableCell>
                        <TableCell className="text-sm">{cl.location || <span className="text-gray-400 text-xs">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{cl.gstin || <span className="text-gray-400">—</span>}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${cl.name}`}
                            onClick={() =>
                              setEditTarget({
                                kind: 'client',
                                id: cl.id,
                                name: cl.name,
                                address: '',
                                location: cl.location || '',
                                gstin: cl.gstin || '',
                              })
                            }
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* BRANDS TAB */}
        {userRole === 'ADMIN' && (
          <TabsContent value="brands" className="mt-4">
            <Card className="shadow-sm">
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/50 dark:bg-gray-900/50">
                      <TableHead>Brand Code</TableHead>
                      <TableHead>Warehouse Brand / Company</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warehouseTypes.map((wt) => (
                      <TableRow key={wt.id}>
                        <TableCell className="font-mono font-bold text-primary">
                          <Badge variant="outline" className="font-mono bg-primary/5 text-primary border-primary/20">
                            {wt.code}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-gray-900 dark:text-white">{wt.name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* CREATE STORE MODAL */}
      <Dialog open={showStoreModal} onOpenChange={setShowStoreModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Warehouse Store</DialogTitle>
            <DialogDescription>
              Create a site under a Client account. A 2-digit Store code will be auto-generated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Store Name *</Label>
              <Input placeholder="e.g. Saket / Khizrabad" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Client Vendor Account *</Label>
              <Select value={storeClientId} onValueChange={setStoreClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{userRole === 'ADMIN' ? ` (Code: ${c.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Warehouse Brand (Company) *</Label>
              <Select value={storeWarehouseTypeId} onValueChange={setStoreWarehouseTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select brand (Amazon, Blinkit, etc.)" />
                </SelectTrigger>
                <SelectContent>
                  {warehouseTypes.map((wt) => (
                    <SelectItem key={wt.id} value={wt.id}>
                      {wt.name}{userRole === 'ADMIN' ? ` (Code: ${wt.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Brand Internal Store Code (Optional)</Label>
              <Input placeholder="e.g. TD02 (Amazon's code)" value={storeExtCode} onChange={(e) => setStoreExtCode(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Full Address</Label>
              <Input placeholder="Street address" value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Location (City / Area)</Label>
                <Input placeholder="e.g. Saket, New Delhi" value={storeLocation} onChange={(e) => setStoreLocation(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>GSTIN (Optional)</Label>
                <Input
                  className="font-mono uppercase"
                  maxLength={15}
                  placeholder="15 characters"
                  value={storeGstin}
                  onChange={(e) => setStoreGstin(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStoreModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateStore} disabled={creatingStore}>
              {creatingStore ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : 'Create Store'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE CLIENT MODAL */}
      <Dialog open={showClientModal} onOpenChange={setShowClientModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Client Vendor Account</DialogTitle>
            <DialogDescription>
              Creates a new staffing client. Code will be assigned automatically (e.g. 10, 11).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Client Account Name *</Label>
              <Input placeholder="e.g. Mansa Maharani" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Short Name / Tag *</Label>
              <Input placeholder="e.g. MM" value={clientShort} onChange={(e) => setClientShort(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input type="email" placeholder="ops@client.com" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Location (City / Region)</Label>
                <Input placeholder="e.g. New Delhi" value={clientLocation} onChange={(e) => setClientLocation(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>GSTIN (Optional)</Label>
                <Input
                  className="font-mono uppercase"
                  maxLength={15}
                  placeholder="15 characters"
                  value={clientGstin}
                  onChange={(e) => setClientGstin(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClientModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateClient} disabled={creatingClient}>
              {creatingClient ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : 'Create Client'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT DETAILS MODAL (stores + clients) */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editTarget?.name}</DialogTitle>
            <DialogDescription>Leave a field empty to clear it.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4 py-2">
              {editTarget.kind === 'store' && (
                <div className="space-y-2">
                  <Label>Full Address</Label>
                  <Input value={editTarget.address} onChange={(e) => setEditTarget({ ...editTarget, address: e.target.value })} />
                </div>
              )}
              <div className="space-y-2">
                <Label>Location (City / Area)</Label>
                <Input value={editTarget.location} onChange={(e) => setEditTarget({ ...editTarget, location: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>GSTIN</Label>
                <Input
                  className="font-mono uppercase"
                  maxLength={15}
                  value={editTarget.gstin}
                  onChange={(e) => setEditTarget({ ...editTarget, gstin: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE BRAND MODAL */}
      <Dialog open={showBrandModal} onOpenChange={setShowBrandModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Warehouse Brand</DialogTitle>
            <DialogDescription>
              Global master list brand (e.g. Amazon, Blinkit). Auto-assigns 2-digit code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Brand Name *</Label>
              <Input placeholder="e.g. Zepto / Instamart" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBrandModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateBrand} disabled={creatingBrand}>
              {creatingBrand ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : 'Create Brand'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
