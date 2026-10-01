'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
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
import { markFormSent } from '@/app/(app)/onboarding/pending-forms/actions';
import { enrollFace } from '@/app/(app)/face-attendance/actions';
import { ENROLL_MIN_SAMPLES } from '@/lib/face/match';
import { normalizeMobile, formatMobile } from '@/lib/whatsapp';
import { CheckCircle2, Check, Copy, ExternalLink, Loader2, Sparkles, UserPlus, Shield, Smartphone, QrCode, MessageCircle, Pencil, ScanFace } from 'lucide-react';
import { toast } from 'sonner';

/** Camera + WebGL face engine — browser only, so never part of the server render. */
const FaceCaptureStep = dynamic(
  () => import('./FaceCaptureStep').then((m) => m.FaceCaptureStep),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 flex items-center justify-center text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading face capture…
      </div>
    ),
  },
);

/** Same roles the server allows to enrol faces (attendance:faceEnroll). */
const FACE_ENROLL_ROLES = ['ADMIN', 'CLIENT', 'MANAGER', 'SHIFT_INCHARGE'];

interface StoreOption {
  id: string;
  name: string;
  code: string;
  faceAttendanceEnabled?: boolean;
  client: { name: string; code: string; shortName: string };
  warehouseType: { name: string; code: string };
}

interface OnboardingWizardProps {
  /** Only ADMIN sees how the employee code is assembled — everyone else just sees the code. */
  role?: string;
}

export function OnboardingWizard({ role }: OnboardingWizardProps = {}) {
  const isAdmin = role === 'ADMIN';
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
  const [mobileNumber, setMobileNumber] = useState('');

  // App login fields (PA/SI/Store Manager only)
  const [createAppLogin, setCreateAppLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [tempPassword, setTempPassword] = useState('');

  // Validation: errors show inline once the user has tried to continue
  // (mobile also shows live, as soon as something is typed).
  const [showErrors, setShowErrors] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Face ID capture (descriptors only — saved after the employee record exists)
  const [faceSamples, setFaceSamples] = useState<number[][]>([]);
  const [faceConsent, setFaceConsent] = useState(false);
  const [faceOutcome, setFaceOutcome] = useState<
    { state: 'ENROLLED' } | { state: 'FAILED'; error: string } | { state: 'SKIPPED' } | null
  >(null);
  const [retryingFace, setRetryingFace] = useState(false);

  // Enrollment mode
  const [enrollmentMode, setEnrollmentMode] = useState<'DIRECT_UPLOAD' | 'REMOTE_LINK'>('DIRECT_UPLOAD');

  // Preview & Submit state
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [previewCapacity, setPreviewCapacity] = useState<{ slotsRemaining: number; nearCapacity: boolean } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Result state
  const [onboardResult, setOnboardResult] = useState<{
    staffCode: string;
    googleFormUrl: string;
    whatsappUrl: string;
    employeeId: string;
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
        .then((res) => {
          setPreviewCode(res.previewCode);
          setPreviewCapacity({ slotsRemaining: res.slotsRemaining, nearCapacity: res.nearCapacity });
        })
        .catch(() => {
          setPreviewCode(null);
          setPreviewCapacity(null);
        })
        .finally(() => setLoadingPreview(false));
    } else {
      setPreviewCode(null);
      setPreviewCapacity(null);
    }
  }, [storeId]);

  const isAppRoleDesignation =
    designation === Designation.PROCESS_ASSOCIATE ||
    designation === Designation.SHIFT_INCHARGE ||
    designation === Designation.STORE_MANAGER;

  const selectedStore = stores.find((x) => x.id === storeId);
  const canEnrollFace = !!role && FACE_ENROLL_ROLES.includes(role);
  const storeFaceOn = !!selectedStore?.faceAttendanceEnabled;
  const faceAvailable = canEnrollFace && storeFaceOn;
  const faceReady = faceAvailable && faceSamples.length >= ENROLL_MIN_SAMPLES && faceConsent;

  // A different store may have face attendance off, and samples are per person — start clean.
  useEffect(() => {
    setFaceSamples([]);
    setFaceConsent(false);
  }, [storeId]);

  const mobileNormalized = normalizeMobile(mobileNumber);
  const errors = {
    name: !name.trim() ? 'Enter the employee\'s full name.' : '',
    mobile:
      !mobileNumber.trim() ? 'Enter a mobile number — the form link is sent here.'
      : mobileNormalized === null ? 'Enter 10 digits, or a number with country code.'
      : '',
    store: !storeId ? 'Select the store this person works at.' : '',
    email:
      isAppRoleDesignation && createAppLogin && (!email || !/^\S+@\S+\.\S+$/.test(email))
        ? 'Enter a valid email for the app login.'
        : '',
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const fieldCls = (msg: string, always = false) =>
    (showErrors || always) && msg ? 'border-red-400 focus-visible:ring-red-400' : '';
  const FieldError = ({ msg, always = false }: { msg: string; always?: boolean }) =>
    (showErrors || always) && msg ? <p className="text-xs text-red-600" role="alert">{msg}</p> : null;

  const handleStep1Next = () => {
    if (hasErrors) {
      setShowErrors(true);
      const first = errors.name ? 'name' : errors.mobile ? 'mobile' : errors.store ? 'store' : 'loginEmail';
      document.getElementById(first)?.focus();
      return;
    }
    setStep(2);
  };

  // Every step change starts at the top of the wizard.
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

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
        mobileNumber,
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

      // The employee exists now, so the captured face can be saved against them.
      // Onboarding itself has already succeeded — a face problem never undoes it.
      if (faceReady) {
        const faceRes = await enrollFace(res.employeeId!, faceSamples, faceConsent);
        setFaceOutcome(faceRes.ok ? { state: 'ENROLLED' } : { state: 'FAILED', error: faceRes.error });
      } else {
        setFaceOutcome({ state: 'SKIPPED' });
      }

      setOnboardResult({
        staffCode: res.staffCode!,
        googleFormUrl: res.googleFormUrl!,
        whatsappUrl: res.whatsappUrl!,
        employeeId: res.employeeId!,
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

  const retryFaceEnrol = async () => {
    if (!onboardResult) return;
    setRetryingFace(true);
    try {
      const r = await enrollFace(onboardResult.employeeId, faceSamples, faceConsent);
      setFaceOutcome(r.ok ? { state: 'ENROLLED' } : { state: 'FAILED', error: r.error });
      if (r.ok) toast.success('Face ID saved.');
    } finally {
      setRetryingFace(false);
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
    <div className="max-w-4xl mx-auto space-y-6" ref={topRef}>
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

        {/* Progress stepper — completed steps can be clicked to go back */}
        <ol className="flex items-center mt-4" aria-label="Onboarding progress">
          {[
            { num: 1, label: 'Basic Details' },
            { num: 2, label: 'Face ID & Biometrics' },
            { num: 3, label: 'Review & Submit' },
            { num: 4, label: 'Confirmation' },
          ].map((st, idx, arr) => {
            const done = step > st.num;
            const current = step === st.num;
            const canGoBack = done && step < 4;
            return (
              <li key={st.num} className={`flex items-center ${idx < arr.length - 1 ? 'flex-1' : ''}`}>
                <button
                  type="button"
                  disabled={!canGoBack}
                  onClick={() => canGoBack && setStep(st.num as 1 | 2 | 3)}
                  aria-current={current ? 'step' : undefined}
                  className={`flex items-center gap-2 ${canGoBack ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
                      done
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : current
                        ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                        : 'bg-white border-gray-300 text-gray-400 dark:bg-gray-900 dark:border-gray-700'
                    }`}
                  >
                    {done ? <Check className="h-4 w-4" /> : st.num}
                  </span>
                  <span
                    className={`hidden sm:inline text-sm whitespace-nowrap ${
                      current ? 'font-semibold text-gray-900 dark:text-white' : done ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-400'
                    }`}
                  >
                    {st.label}
                  </span>
                </button>
                {idx < arr.length - 1 && (
                  <span className={`mx-3 h-px flex-1 ${done ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-800'}`} />
                )}
              </li>
            );
          })}
        </ol>
        <p className="sm:hidden text-xs text-gray-500 mt-1">
          Step {Math.min(step, 4)} of 4
        </p>
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
          <CardContent
            className="space-y-4"
            onKeyDown={(e) => {
              // Enter in a text box moves on, like submitting a form (not inside dropdowns/buttons).
              if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
                e.preventDefault();
                handleStep1Next();
              }
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g. Ramesh Kumar"
                  value={name}
                  autoFocus
                  aria-invalid={showErrors && !!errors.name}
                  className={fieldCls(errors.name)}
                  onChange={(e) => setName(e.target.value)}
                />
                <FieldError msg={errors.name} />
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
                <Label htmlFor="mobile">Mobile Number (WhatsApp) *</Label>
                <Input
                  id="mobile"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="e.g. 98765 43210"
                  value={mobileNumber}
                  aria-invalid={(showErrors || !!mobileNumber.trim()) && !!errors.mobile}
                  className={fieldCls(errors.mobile, !!mobileNumber.trim())}
                  onChange={(e) => setMobileNumber(e.target.value)}
                />
                {mobileNormalized && !errors.mobile ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    <Check className="inline w-3 h-3 mr-1" />
                    {formatMobile(mobileNormalized)}
                  </p>
                ) : (
                  <FieldError msg={errors.mobile} always={!!mobileNumber.trim()} />
                )}
                {!errors.mobile && !mobileNormalized && !showErrors && (
                  <p className="text-xs text-gray-500">The onboarding form link is sent to this number on WhatsApp.</p>
                )}
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
                    <SelectTrigger id="store" aria-invalid={showErrors && !!errors.store} className={fieldCls(errors.store)}>
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
                <FieldError msg={errors.store} />
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
                    <SelectItem value={Designation.HOUSEKEEPING}>
                      Housekeeping (No App Login)
                    </SelectItem>
                    <SelectItem value={Designation.PROCESS_ASSOCIATE}>
                      Process Associate (Grants App Login)
                    </SelectItem>
                    <SelectItem value={Designation.SHIFT_INCHARGE}>
                      Shift Incharge (Grants App Login)
                    </SelectItem>
                    <SelectItem value={Designation.STORE_MANAGER}>
                      Store Manager (Grants App Login)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  {isAppRoleDesignation
                    ? 'Can also get an app login — set it up below.'
                    : 'Attendance only — no app login is created.'}
                </p>
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
                  <div className="text-xs text-gray-500 font-medium">Employee Code</div>
                  <div className="text-lg font-mono font-bold text-gray-900 dark:text-white">
                    {loadingPreview ? 'Generating...' : previewCode}
                  </div>
                  {isAdmin && (
                    <div className="text-xs text-gray-500 mt-1">
                      [Client Code][Brand Code][Store Code][Serial][Check Digit]
                    </div>
                  )}
                </div>
                <Badge variant="secondary" className="font-mono">
                  Auto-generated
                </Badge>
              </div>
            )}
            {previewCapacity?.nearCapacity && (
              <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2">
                {previewCapacity.slotsRemaining === 0
                  ? 'This store has no employee codes left — an Admin needs to add another store entry before anyone else can be onboarded here.'
                  : `Only ${previewCapacity.slotsRemaining} employee code${previewCapacity.slotsRemaining === 1 ? '' : 's'} left for this store — an Admin will need to add another store entry soon.`}
              </p>
            )}

            {/* Conditional App Login Sub-step for PA / SI / Store Manager */}
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
                        aria-invalid={showErrors && !!errors.email}
                        className={fieldCls(errors.email)}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      <FieldError msg={errors.email} />
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
              Next: Face ID &rarr;
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP 2: FACE ID & BIOMETRICS */}
      {step === 2 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Step 2: Face ID & Biometric Enrollment</CardTitle>
            <CardDescription>
              Capture the associate's face for phone attendance, and choose how they enrol on the SmartOffice scanners.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Face ID capture */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-2">
                  <ScanFace className="w-4 h-4 text-primary" /> Face ID (Optional)
                </Label>
                {faceAvailable && (
                  <Badge variant={faceReady ? 'default' : 'secondary'}>
                    {faceReady ? 'Ready to save' : 'Not captured'}
                  </Badge>
                )}
              </div>
              {!canEnrollFace ? (
                <p className="text-sm text-gray-600 rounded-lg border bg-gray-50 p-3 dark:bg-gray-900 dark:text-gray-400">
                  Your role can't enrol faces. A Manager, Shift Incharge, Client or Admin can add this person's Face ID later from Face Attendance &rarr; Enroll.
                </p>
              ) : !storeFaceOn ? (
                <p className="text-sm text-gray-600 rounded-lg border bg-gray-50 p-3 dark:bg-gray-900 dark:text-gray-400">
                  Face attendance is switched off for {selectedStore?.name ?? 'this store'}, so Face ID can't be saved yet. An Admin or Client can switch it on in Stores &amp; Brands — you can enrol this person afterwards from Face Attendance &rarr; Enroll.
                </p>
              ) : (
                <FaceCaptureStep
                  samples={faceSamples}
                  onSamplesChange={setFaceSamples}
                  consent={faceConsent}
                  onConsentChange={setFaceConsent}
                />
              )}
              {faceAvailable && !faceReady && faceSamples.length > 0 && (
                <p className="text-xs text-amber-600">
                  {faceSamples.length < ENROLL_MIN_SAMPLES
                    ? `Capture at least ${ENROLL_MIN_SAMPLES} samples to save Face ID, or continue to skip it.`
                    : 'Tick the consent box to save Face ID, or continue to skip it.'}
                </p>
              )}
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
            <div className="flex justify-end -mb-2">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit details
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border text-sm">
              <div>
                <span className="text-gray-500 block text-xs">Employee Name</span>
                <span className="font-semibold">{name}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Designation</span>
                <span className="font-semibold">{designation.replace(/_/g, ' ')}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Assigned E-Code</span>
                <span className="font-mono font-bold text-primary">{previewCode || 'Generating...'}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Store</span>
                <span className="font-semibold">
                  {stores.find((x) => x.id === storeId)?.name ?? '-'}
                </span>
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
                <span className="text-gray-500 block text-xs">Mobile</span>
                <span>{formatMobile(normalizeMobile(mobileNumber)) || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Face ID</span>
                <span>
                  {faceReady
                    ? `Captured (${faceSamples.length} samples)`
                    : faceAvailable
                      ? 'Not captured'
                      : 'Not available for this store/role'}
                </span>
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
            {/* Next action first: get the form to the associate */}
            <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-green-200 space-y-2">
              <div className="font-medium text-sm">Next: send the paperwork form</div>
              {onboardResult.whatsappUrl ? (
                <Button size="lg" className="w-full bg-green-600 hover:bg-green-700 text-white" asChild>
                  <a
                    href={onboardResult.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      // Record the send so Pending Forms shows "Awaiting", not "Not sent".
                      // Best effort: roles without form-tracking access simply skip it.
                      markFormSent(onboardResult.employeeId).catch(() => {});
                    }}
                  >
                    <MessageCircle className="w-4 h-4 mr-2" /> Send form link on WhatsApp
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-amber-600">
                  No onboarding form is configured for this store, so there is no link to send yet.
                </p>
              )}
            </div>

            {/* Face ID result */}
            {faceOutcome && faceOutcome.state !== 'SKIPPED' && (
              <div
                className={`p-4 rounded-lg border space-y-2 ${
                  faceOutcome.state === 'ENROLLED'
                    ? 'bg-white dark:bg-slate-900 border-emerald-200'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <ScanFace className="w-4 h-4" />
                  {faceOutcome.state === 'ENROLLED' ? 'Face ID saved' : 'Face ID was not saved'}
                </div>
                {faceOutcome.state === 'FAILED' && (
                  <>
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      {faceOutcome.error} The employee was still onboarded.
                    </p>
                    <Button size="sm" variant="outline" onClick={retryFaceEnrol} disabled={retryingFace}>
                      {retryingFace ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Try saving again
                    </Button>
                  </>
                )}
              </div>
            )}

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
                // Keep store / designation / grade / team — people are usually onboarded in batches.
                setStep(1);
                setName('');
                setFaceSamples([]);
                setFaceConsent(false);
                setFaceOutcome(null);
                setMobileNumber('');
                setDateOfBirth('');
                setCreateAppLogin(false);
                setEmail('');
                setTempPassword('');
                setShowErrors(false);
                setCmdStatus('PENDING');
                setOnboardResult(null);
                // the next E-Code is different — refresh the preview
                if (storeId) {
                  getStoreECodePreviewAction(storeId)
                    .then((res) => {
                      setPreviewCode(res.previewCode);
                      setPreviewCapacity({ slotsRemaining: res.slotsRemaining, nearCapacity: res.nearCapacity });
                    })
                    .catch(() => setPreviewCode(null));
                }
              }}
            >
              Onboard Another (same store)
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
