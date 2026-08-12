'use client';

import { useState, useEffect } from 'react';
import { Designation } from '@prisma/client';
import {
  getStoresForOnboardingAction,
  getStoreECodePreviewAction,
  submitOnboardingAction,
  getCommandStatusAction,
  OnboardingSubmitInput,
} from '@/app/(app)/onboarding/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, AlertTriangle, Copy, ExternalLink, Loader2, Sparkles, UserPlus, Shield, Smartphone, QrCode } from 'lucide-react';
import { toast } from 'sonner';

interface StoreOption {
  id: string;
  name: string;
  code: string;
  client: { name: string; code: string; shortName: string };
  warehouseType: { name: string; code: string };
}

export function OnboardingWizard() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);

  // Form State
  const [name, setName] = useState('');
  const [gender, setGender] = useState<string>('Male');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [storeId, setStoreId] = useState('');
  const [designation, setDesignation] = useState<Designation>(Designation.ASSOCIATE);
  const [grade, setGrade] = useState('');
  const [team, setTeam] = useState('');
  const [cardNumber, setCardNumber] = useState('');

  // App login fields (PA/SI only)
  const [createAppLogin, setCreateAppLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [tempPassword, setTempPassword] = useState('');

  // Enrollment mode
  const [enrollmentMode, setEnrollmentMode] = useState<'DIRECT_UPLOAD' | 'REMOTE_LINK'>('DIRECT_UPLOAD');

  // Preview & Submit state
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Result state
  const [onboardResult, setOnboardResult] = useState<{
    staffCode: string;
    googleFormUrl: string;
    commandId: string;
  } | null>(null);
  const [cmdStatus, setCmdStatus] = useState<string>('PENDING');

  useEffect(() => {
    getStoresForOnboardingAction()
      .then((data) => {
        setStores(data as any);
        if (data.length === 1) {
          setStoreId(data[0].id);
        }
      })
      .catch((err) => toast.error('Failed to load stores: ' + err.message))
      .finally(() => setLoadingStores(false));
  }, []);

  useEffect(() => {
    if (storeId) {
      setLoadingPreview(true);
      getStoreECodePreviewAction(storeId)
        .then((res) => setPreviewCode(res.previewCode))
        .catch(() => setPreviewCode(null))
        .finally(() => setLoadingPreview(false));
    } else {
      setPreviewCode(null);
    }
  }, [storeId]);

  const isAppRoleDesignation =
    designation === Designation.PROCESS_ASSOCIATE || designation === Designation.SHIFT_INCHARGE;

  const handleStep1Next = () => {
    if (!name.trim()) {
      toast.error('Please enter the employee name');
      return;
    }
    if (!storeId) {
      toast.error('Please select a store');
      return;
    }
    if (isAppRoleDesignation && createAppLogin && (!email || !email.includes('@'))) {
      toast.error('Please enter a valid email for app login');
      return;
    }
    setStep(2);
  };

  const handleStep2Next = () => {
    setStep(3);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload: OnboardingSubmitInput = {
        name,
        gender,
        dateOfBirth: dateOfBirth || undefined,
        storeId,
        designation,
        grade: grade || undefined,
        team: team || undefined,
        cardNumber: cardNumber || undefined,
        createAppLogin: isAppRoleDesignation ? createAppLogin : false,
        email: isAppRoleDesignation && createAppLogin ? email : undefined,
        password: isAppRoleDesignation && createAppLogin && tempPassword ? tempPassword : undefined,
        enrollmentMode,
      };

      const res = await submitOnboardingAction(payload);
      if (!res.ok) {
        toast.error(res.error || 'Onboarding failed');
        return;
      }

      setOnboardResult({
        staffCode: res.staffCode!,
        googleFormUrl: res.googleFormUrl!,
        commandId: res.commandId!,
      });
      toast.success(`Associate ${res.staffCode} onboarded successfully!`);
      setStep(4);
    } catch (err: any) {
      toast.error(err.message || 'Unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  // Poll command status in step 4
  useEffect(() => {
    if (step !== 4 || !onboardResult?.commandId) return;

    const interval = setInterval(async () => {
      const status = await getCommandStatusAction(onboardResult.commandId);
      if (status) {
        setCmdStatus(status.status);
        if (status.status === 'SUCCEEDED' || status.status === 'FAILED') {
          clearInterval(interval);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [step, onboardResult?.commandId]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header & Steps Indicator */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-primary" /> Employee Onboarding Wizard
          </h1>
          {previewCode && (
            <Badge variant="outline" className="text-sm px-3 py-1 bg-primary/10 text-primary border-primary/20 font-mono">
              Auto E-Code: <span className="font-bold ml-1">{previewCode}</span>
            </Badge>
          )}
        </div>
        <p className="text-sm text-gray-500">
          Onboard new associates, auto-assign 10-digit E-Codes, and sync biometric enrollment.
        </p>

        {/* Progress Bar */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { num: 1, label: 'Basic Details' },
            { num: 2, label: 'Biometrics & Card' },
            { num: 3, label: 'Review & Submit' },
            { num: 4, label: 'Confirmation' },
          ].map((s) => (
            <div
              key={s.num}
              className={`p-3 rounded-lg border text-center transition-all ${
                step === s.num
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm font-semibold'
                  : step > s.num
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-900'
              }`}
            >
              <div className="text-xs uppercase tracking-wider font-medium">Step {s.num}</div>
              <div className="text-sm truncate">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: BASIC DETAILS */}
      {step === 1 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Step 1: Associate Information & Store Assignment</CardTitle>
            <CardDescription>
              Enter personal details and designation. Store choice generates the 10-digit E-Code automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g. Ramesh Kumar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger id="gender">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input
                  id="dob"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="store">Store / Site *</Label>
                {loadingStores ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading assigned stores...
                  </div>
                ) : (
                  <Select value={storeId} onValueChange={setStoreId}>
                    <SelectTrigger id="store">
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
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="designation">Designation *</Label>
                <Select
                  value={designation}
                  onValueChange={(val) => setDesignation(val as Designation)}
                >
                  <SelectTrigger id="designation">
                    <SelectValue placeholder="Select designation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={Designation.ASSOCIATE}>
                      Associate (No App Login)
                    </SelectItem>
                    <SelectItem value={Designation.QUALITY_ASSOCIATE}>
                      Quality Associate (No App Login)
                    </SelectItem>
                    <SelectItem value={Designation.PROCESS_ASSOCIATE}>
                      Process Associate (Grants App Login)
                    </SelectItem>
                    <SelectItem value={Designation.SHIFT_INCHARGE}>
                      Shift Incharge (Grants App Login)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="grade">Grade / Level</Label>
                <Input
                  id="grade"
                  placeholder="e.g. L1 / Grade A"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="team">Team / Department</Label>
                <Input
                  id="team"
                  placeholder="e.g. Inbound / Outbound / Sorting"
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                />
              </div>
            </div>

            {/* Generated Code Preview Box */}
            {storeId && (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500 font-medium">System E-Code Format</div>
                  <div className="text-lg font-mono font-bold text-gray-900 dark:text-white">
                    {loadingPreview ? 'Generating...' : previewCode}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    [Client Code][Brand Code][Store Code][Serial]
                  </div>
                </div>
                <Badge variant="secondary" className="font-mono">
                  10 Digits Auto
                </Badge>
              </div>
            )}

            {/* Conditional App Login Sub-step for PA / SI */}
            {isAppRoleDesignation && (
              <div className="p-4 rounded-lg border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-900 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-indigo-950 dark:text-indigo-200">
                    <Shield className="w-5 h-5 text-indigo-600" /> Create Platform App Credentials
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="createAppLogin"
                      checked={createAppLogin}
                      onCheckedChange={(c) => setCreateAppLogin(!!c)}
                    />
                    <label htmlFor="createAppLogin" className="text-sm font-medium cursor-pointer">
                      Enable App Access
                    </label>
                  </div>
                </div>
                <p className="text-xs text-indigo-700 dark:text-indigo-300">
                  Designations ({designation.replace('_', ' ')}) can manage store operations in this app.
                  Checking this creates a linked login account.
                </p>

                {createAppLogin && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <Label htmlFor="loginEmail" className="text-xs">User Email *</Label>
                      <Input
                        id="loginEmail"
                        type="email"
                        placeholder="associate@store.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tempPass" className="text-xs">Temporary Password (Optional)</Label>
                      <Input
                        id="tempPass"
                        type="text"
                        placeholder="Leave blank to auto-generate"
                        value={tempPassword}
                        onChange={(e) => setTempPassword(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button onClick={handleStep1Next} size="lg">
              Next: Biometrics & Card &rarr;
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP 2: BIOMETRICS & CARD */}
      {step === 2 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Step 2: Biometric & Smart Card Enrollment</CardTitle>
            <CardDescription>
              Specify card number or choose enrollment method for SmartOffice biometric scanners.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="cardNumber">Smart Card / RFID Number (Optional)</Label>
              <Input
                id="cardNumber"
                placeholder="e.g. 10048592"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label>Enrollment Method</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  onClick={() => setEnrollmentMode('DIRECT_UPLOAD')}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    enrollmentMode === 'DIRECT_UPLOAD'
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-gray-200 hover:border-gray-300 dark:border-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Smartphone className="w-6 h-6 text-primary" />
                    <div>
                      <div className="font-semibold text-sm">Kiosk Direct Sync</div>
                      <div className="text-xs text-gray-500">
                        Upload employee profile directly to store biometric scanner via SmartOffice queue.
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => setEnrollmentMode('REMOTE_LINK')}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    enrollmentMode === 'REMOTE_LINK'
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-gray-200 hover:border-gray-300 dark:border-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <QrCode className="w-6 h-6 text-primary" />
                    <div>
                      <div className="font-semibold text-sm">Remote Self-Enrollment Link</div>
                      <div className="text-xs text-gray-500">
                        Send self-enrollment link/QR to associate's mobile device for remote face registration.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              &larr; Back
            </Button>
            <Button onClick={handleStep2Next}>
              Next: Review & Submit &rarr;
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP 3: REVIEW & SUBMIT */}
      {step === 3 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Step 3: Review Details & Confirm Onboarding</CardTitle>
            <CardDescription>
              Verify information before writing to system database and SmartOffice outbound queue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border text-sm">
              <div>
                <span className="text-gray-500 block text-xs">Employee Name</span>
                <span className="font-semibold">{name}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Designation</span>
                <span className="font-semibold">{designation.replace('_', ' ')}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Assigned E-Code</span>
                <span className="font-mono font-bold text-primary">{previewCode || 'Generating...'}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Gender</span>
                <span>{gender || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Date of Birth</span>
                <span>{dateOfBirth || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Card Number</span>
                <span>{cardNumber || 'None'}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Enrollment Mode</span>
                <Badge variant="outline">{enrollmentMode}</Badge>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">App Login</span>
                <span>{isAppRoleDesignation && createAppLogin ? email : 'No app access'}</span>
              </div>
            </div>

            <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-900">
              <Sparkles className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-300">Local-First Queueing</AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-400 text-xs">
                Submitting will save the associate locally immediately. SmartOffice device sync is queued asynchronously with retry backoff.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              &larr; Back
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} size="lg">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving & Enqueueing...
                </>
              ) : (
                'Confirm & Complete Onboarding'
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP 4: CONFIRMATION & COMMAND TRACKING */}
      {step === 4 && onboardResult && (
        <Card className="shadow-sm border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              <div>
                <CardTitle className="text-emerald-950 dark:text-emerald-100">
                  Onboarding Complete!
                </CardTitle>
                <CardDescription>
                  Associate has been registered with E-Code{' '}
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {onboardResult.staffCode}
                  </span>
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Sync Command Badge */}
            <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SmartOffice Device Command Status
                </span>
                <Badge
                  variant={
                    cmdStatus === 'SUCCEEDED'
                      ? 'default'
                      : cmdStatus === 'FAILED'
                      ? 'destructive'
                      : 'secondary'
                  }
                  className="font-mono"
                >
                  {cmdStatus === 'PENDING' && (
                    <Loader2 className="w-3 h-3 animate-spin mr-1 inline" />
                  )}
                  {cmdStatus}
                </Badge>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Command ID: <code className="text-slate-800 dark:text-slate-200">{onboardResult.commandId}</code>
              </p>
            </div>

            {/* Pre-filled Google Form Link */}
            <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border space-y-3">
              <div className="font-medium text-sm text-gray-900 dark:text-white flex items-center justify-between">
                <span>Google Form Onboarding Paperwork Link</span>
                <Badge variant="outline" className="text-xs">
                  Pre-filled with E-Code
                </Badge>
              </div>
              <p className="text-xs text-gray-500">
                Share this unique pre-filled link with the associate to complete their full paperwork. Their E-Code will auto-fill.
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={onboardResult.googleFormUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(onboardResult.googleFormUrl);
                    toast.success('Google Form link copied to clipboard!');
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" /> Copy
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <a href={onboardResult.googleFormUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="w-4 h-4 mr-1" /> Open
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setStep(1);
                setName('');
                setCardNumber('');
                setPreviewCode(null);
                setOnboardResult(null);
              }}
            >
              Onboard Another Associate
            </Button>
            <Button asChild>
              <a href="/employees">View in Employee Directory &rarr;</a>
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
