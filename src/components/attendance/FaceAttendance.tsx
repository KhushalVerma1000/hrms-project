'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getFaceContext,
  recordFacePunch,
  enrollFace,
  deleteFaceData,
  type FaceContext,
  type FacePunchResult,
} from '@/app/(app)/face-attendance/actions';
import { loadFaceEngine, scanFrame, poseFrame, type FrameResult } from '@/lib/face/engine';
import {
  SAME_PERSON_MAX,
  challengeHint,
  isFrontal,
  pickDirection,
  startChallenge,
  stepChallenge,
  type ChallengeState,
  type TurnDirection,
} from '@/lib/face/liveness';
import { ENROLL_MAX_SAMPLES, ENROLL_MIN_SAMPLES, distance } from '@/lib/face/match';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Camera, CameraOff, Loader2, RefreshCw, SwitchCamera, Trash2 } from 'lucide-react';

type Facing = 'environment' | 'user';
type CamState = 'off' | 'starting' | 'on' | 'error';
type EngineState = 'idle' | 'loading' | 'ready' | 'error';

interface Props {
  stores: { id: string; name: string; client: { shortName: string } }[];
}

interface RecentPunch {
  key: number;
  name: string;
  text: string;
  tone: 'good' | 'info' | 'warn' | 'bad';
  time: string;
}

/** Two consecutive good frames must be this close to count as "held steady" before we submit. */
const STEADY_DISTANCE = 0.35;
const TICK_MS = 500;
const PAUSE_AFTER_RESULT_MS = 3000;
const PAUSE_AFTER_LIVENESS_FAIL_MS = 1500;

/**
 * Escape hatch for rollout: set NEXT_PUBLIC_FACE_LIVENESS=off to skip the
 * head-turn check (e.g. if thresholds misbehave on a phone model). Leave unset
 * for normal use.
 */
const LIVENESS_ENABLED = process.env.NEXT_PUBLIC_FACE_LIVENESS !== 'off';

const HINTS: Record<Exclude<FrameResult['status'], 'OK'>, string> = {
  NO_FACE: 'No face in view',
  MULTIPLE: 'One person at a time, please',
  TOO_FAR: 'Move closer',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describePunch(r: FacePunchResult): { text: string; tone: RecentPunch['tone']; name: string } {
  if (!r.ok) return { text: r.error, tone: 'bad', name: r.employeeName ?? 'Not recognised' };
  const t = fmtTime(r.at);
  switch (r.outcome) {
    case 'CHECKED_IN': return { text: `Checked in at ${t}`, tone: 'good', name: r.employee.name };
    case 'CHECKED_OUT': return { text: `Checked out at ${t}`, tone: 'info', name: r.employee.name };
    case 'CHECK_OUT_UPDATED': return { text: `Check-out updated to ${t}`, tone: 'info', name: r.employee.name };
    case 'ALREADY_RECORDED': return { text: `Already recorded at ${t}`, tone: 'warn', name: r.employee.name };
  }
}

const TONE_CLASS: Record<RecentPunch['tone'], string> = {
  good: 'bg-green-50 border-green-200 text-green-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  bad: 'bg-red-50 border-red-200 text-red-800',
};

export function FaceAttendance({ stores }: Props) {
  const [storeId, setStoreId] = useState(stores[0]!.id);
  const [ctx, setCtx] = useState<FaceContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);

  const [tab, setTab] = useState<'scan' | 'enroll'>('scan');
  const [facing, setFacing] = useState<Facing>('environment');
  const [cam, setCam] = useState<CamState>('off');
  const [camError, setCamError] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineState>('idle');
  const [hint, setHint] = useState('Start the camera to begin');

  const [result, setResult] = useState<RecentPunch | null>(null);
  const [recent, setRecent] = useState<RecentPunch[]>([]);

  const [enrollEmployeeId, setEnrollEmployeeId] = useState('');
  const [samples, setSamples] = useState<number[][]>([]);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Refs let the scan loop read fresh values without restarting on every render.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<Awaited<ReturnType<typeof loadFaceEngine>> | null>(null);
  const tabRef = useRef(tab);
  const storeIdRef = useRef(storeId);
  const busyRef = useRef(false);
  const pausedUntilRef = useRef(0);
  const lastGoodRef = useRef<number[] | null>(null);
  const latestForEnrollRef = useRef<{ descriptor: number[]; at: number } | null>(null);
  const keyRef = useRef(0);
  const facingRef = useRef<Facing>(facing);
  const challengeRef = useRef<{ state: ChallengeState; startDescriptor: number[] } | null>(null);
  const lastDirectionRef = useRef<TurnDirection | null>(null);

  useEffect(() => { tabRef.current = tab; challengeRef.current = null; }, [tab]);
  useEffect(() => { storeIdRef.current = storeId; }, [storeId]);
  useEffect(() => { facingRef.current = facing; }, [facing]);

  // ─── Store context (roster + enrolment status) ───────────────────────────
  const loadContext = useCallback(async (id: string) => {
    setCtxError(null);
    const res = await getFaceContext(id);
    if (res.ok) setCtx(res.data);
    else { setCtx(null); setCtxError(res.error); }
  }, []);

  useEffect(() => {
    setSamples([]);
    setEnrollEmployeeId('');
    setEnrollMsg(null);
    setResult(null);
    challengeRef.current = null;
    void loadContext(storeId);
  }, [storeId, loadContext]);

  // ─── Camera ──────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCam('off');
  }, []);

  const startCamera = useCallback(async (which: Facing) => {
    setCam('starting');
    setCamError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('The camera needs a secure (https) connection.');
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: which }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Camera view is not ready.');
      video.srcObject = stream;
      await video.play();
      setCam('on');
      setHint('Point the camera at a face');
    } catch (err) {
      setCam('error');
      const name = err instanceof DOMException ? err.name : '';
      setCamError(
        name === 'NotAllowedError'
          ? 'Camera permission was blocked. Allow camera access for this site in your browser settings, then try again.'
          : err instanceof Error ? err.message : 'Could not start the camera.',
      );
    }
  }, []);

  const startAll = useCallback(async () => {
    if (engine !== 'ready') {
      setEngine('loading');
      loadFaceEngine()
        .then((fa) => { engineRef.current = fa; setEngine('ready'); })
        .catch(() => setEngine('error'));
    }
    await startCamera(facing);
  }, [engine, facing, startCamera]);

  const flipCamera = useCallback(async () => {
    const next: Facing = facing === 'environment' ? 'user' : 'environment';
    challengeRef.current = null; // the left/right mapping changes with the camera
    facingRef.current = next;
    setFacing(next);
    await startCamera(next);
  }, [facing, startCamera]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // ─── The scan loop ───────────────────────────────────────────────────────
  useEffect(() => {
    if (cam !== 'on' || engine !== 'ready') return;
    let cancelled = false;
    let timer: number | undefined;
    busyRef.current = false; // a previous loop may have been cancelled mid-frame
    challengeRef.current = null;

    const submit = async (descriptor: number[]) => {
      busyRef.current = true;
      setHint('Checking…');
      const res = await recordFacePunch(storeIdRef.current, descriptor);
      const d = describePunch(res);
      const entry: RecentPunch = {
        key: ++keyRef.current,
        name: d.name,
        text: d.text,
        tone: d.tone,
        time: new Date().toISOString(),
      };
      setResult(entry);
      setRecent((prev) => [entry, ...prev].slice(0, 8));
      if (res.ok) void loadContext(storeIdRef.current);
      lastGoodRef.current = null;
      pausedUntilRef.current = Date.now() + PAUSE_AFTER_RESULT_MS;
      setHint('Next person');
    };

    const failLiveness = (hint: string) => {
      challengeRef.current = null;
      lastGoodRef.current = null;
      pausedUntilRef.current = Date.now() + PAUSE_AFTER_LIVENESS_FAIL_MS;
      setHint(hint);
    };

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      const fa = engineRef.current;
      let nextDelay = TICK_MS;
      const ready =
        video && fa && video.readyState >= 2 && !document.hidden &&
        !busyRef.current && Date.now() >= pausedUntilRef.current;

      if (ready) {
        busyRef.current = true;
        try {
          const challenge = challengeRef.current;

          if (challenge && tabRef.current === 'scan') {
            // ── Liveness challenge in progress: fast pose-only frames ──
            nextDelay = 0;
            const pose = await poseFrame(fa, video);
            if (cancelled) return;
            const next = stepChallenge(challenge.state, pose.status === 'OK' ? pose.yaw : null, Date.now());

            if (next.phase === 'FAILED') {
              failLiveness(challengeHint(next));
            } else if (next.phase === 'PASSED') {
              // Grab the final frontal descriptor and make sure it's still the same person.
              const final = await scanFrame(fa, video);
              if (cancelled) return;
              if (final.status !== 'OK' || !isFrontal(final.yaw)) {
                failLiveness('Look straight at the camera — start again');
              } else if (distance(challenge.startDescriptor, final.descriptor) > SAME_PERSON_MAX) {
                failLiveness('Face changed during the check — start again');
              } else {
                challengeRef.current = null;
                await submit(final.descriptor);
              }
            } else {
              challengeRef.current = { ...challenge, state: next };
              setHint(challengeHint(next));
            }
          } else {
            // ── Normal scanning ──
            const frame = await scanFrame(fa, video);
            if (cancelled) return;

            if (frame.status !== 'OK') {
              lastGoodRef.current = null;
              latestForEnrollRef.current = null;
              setHint(HINTS[frame.status]);
            } else if (tabRef.current === 'enroll') {
              latestForEnrollRef.current = { descriptor: frame.descriptor, at: Date.now() };
              setHint('Face ready — tap Capture');
            } else if (!isFrontal(frame.yaw)) {
              lastGoodRef.current = null;
              setHint('Look straight at the camera');
            } else {
              const prev = lastGoodRef.current;
              if (prev && distance(prev, frame.descriptor) < STEADY_DISTANCE) {
                if (LIVENESS_ENABLED) {
                  // Steady, frontal, recognisable face → start a random head-turn challenge.
                  const direction = pickDirection(lastDirectionRef.current);
                  lastDirectionRef.current = direction;
                  const state = startChallenge(direction, facingRef.current === 'user', Date.now());
                  challengeRef.current = { state, startDescriptor: frame.descriptor };
                  setResult(null);
                  setHint(challengeHint(state));
                } else {
                  await submit(frame.descriptor);
                }
              } else {
                lastGoodRef.current = frame.descriptor;
                setHint('Hold still…');
              }
            }
          }
        } catch {
          challengeRef.current = null;
        } finally {
          busyRef.current = false;
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, nextDelay);
    };

    timer = window.setTimeout(tick, TICK_MS);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [cam, engine, loadContext]);

  // ─── Enrolment actions ───────────────────────────────────────────────────
  const captureSample = () => {
    const latest = latestForEnrollRef.current;
    if (!latest || Date.now() - latest.at > 2000) {
      setEnrollMsg({ ok: false, text: 'No clear face right now. Hold the camera steady on one face and try again.' });
      return;
    }
    setEnrollMsg(null);
    setSamples((s) => (s.length >= ENROLL_MAX_SAMPLES ? s : [...s, latest.descriptor]));
    latestForEnrollRef.current = null;
  };

  const saveEnrollment = async () => {
    setSaving(true);
    setEnrollMsg(null);
    const res = await enrollFace(enrollEmployeeId, samples, consent);
    setSaving(false);
    if (res.ok) {
      setEnrollMsg({ ok: true, text: 'Face enrolled. This person can now be scanned.' });
      setSamples([]);
      setConsent(false);
      await loadContext(storeId);
    } else {
      setEnrollMsg({ ok: false, text: res.error });
    }
  };

  const removeFaceData = async () => {
    if (!enrollEmployeeId) return;
    if (!window.confirm('Delete this employee’s face data? They will no longer be recognised by scans.')) return;
    setSaving(true);
    const res = await deleteFaceData(enrollEmployeeId);
    setSaving(false);
    setEnrollMsg(res.ok ? { ok: true, text: 'Face data deleted.' } : { ok: false, text: res.error });
    if (res.ok) await loadContext(storeId);
  };

  const selectedEmployee = ctx?.roster.find((e) => e.id === enrollEmployeeId) ?? null;
  const enrolledCount = ctx?.roster.filter((e) => e.samples > 0).length ?? 0;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Face Attendance</h1>
        <p className="text-sm text-gray-500">
          Scan an employee’s face to mark them present. The first scan of the day is check-in; a later scan is check-out.
        </p>
      </div>

      {stores.length > 1 && (
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
          <SelectContent>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.client.shortName} — {s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {ctxError && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm p-3">{ctxError}</div>
      )}

      {ctx && (
        <>
          {/* Camera — shared by both tabs */}
          <Card>
            <CardContent className="p-3 space-y-3">
              <div className="relative overflow-hidden rounded-lg bg-black aspect-[4/3]">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                  style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
                />
                {cam !== 'on' && (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm">
                    {cam === 'starting' ? <Loader2 className="h-6 w-6 animate-spin" /> : <CameraOff className="h-8 w-8" />}
                  </div>
                )}
                {cam === 'on' && (
                  <div className="absolute bottom-2 left-2 right-2 text-center">
                    <span className="inline-block rounded-full bg-black/60 text-white text-xs px-3 py-1">
                      {engine === 'loading' ? 'Loading face models…' : hint}
                    </span>
                  </div>
                )}
              </div>

              {camError && <p className="text-sm text-red-700">{camError}</p>}
              {engine === 'error' && (
                <p className="text-sm text-red-700">
                  Could not load the face models. Check your connection and tap Start again.
                </p>
              )}

              <div className="flex gap-2">
                {cam === 'on' ? (
                  <>
                    <Button variant="outline" onClick={stopCamera} className="flex-1">
                      <CameraOff className="h-4 w-4 mr-2" /> Stop
                    </Button>
                    <Button variant="outline" onClick={flipCamera} aria-label="Switch camera">
                      <SwitchCamera className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <Button onClick={startAll} disabled={cam === 'starting'} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" /> {cam === 'starting' ? 'Starting…' : 'Start camera'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'scan' | 'enroll')}>
            <TabsList className={ctx.canEnroll ? 'grid grid-cols-2 w-full' : 'grid grid-cols-1 w-full'}>
              <TabsTrigger value="scan">Scan</TabsTrigger>
              {ctx.canEnroll && <TabsTrigger value="enroll">Enroll faces</TabsTrigger>}
            </TabsList>

            {/* ── Scan ── */}
            <TabsContent value="scan" className="space-y-3">
              {result && (
                <div className={`rounded-lg border p-4 ${TONE_CLASS[result.tone]}`}>
                  <p className="text-lg font-semibold">{result.name}</p>
                  <p className="text-sm">{result.text}</p>
                </div>
              )}

              <p className="text-xs text-gray-500">
                {enrolledCount} of {ctx.roster.length} employees enrolled at {ctx.store.name}.
                {enrolledCount === 0 && ctx.canEnroll && ' Use “Enroll faces” to add people.'}
              </p>

              {recent.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">This session</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {recent.map((r) => (
                      <div key={r.key} className="flex items-start justify-between gap-3 text-sm">
                        <span className="font-medium truncate">{r.name}</span>
                        <span className="text-gray-500 text-right">{r.tone === 'bad' ? 'Not recorded' : r.text}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ── Enroll ── */}
            {ctx.canEnroll && (
              <TabsContent value="enroll" className="space-y-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Enroll a face</CardTitle>
                    <CardDescription>
                      Pick the employee, then capture {ENROLL_MIN_SAMPLES}–{ENROLL_MAX_SAMPLES} samples: face the camera, then slightly left and right.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Select
                      value={enrollEmployeeId}
                      onValueChange={(v) => { setEnrollEmployeeId(v); setSamples([]); setEnrollMsg(null); }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                      <SelectContent>
                        {ctx.roster.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}{e.samples > 0 ? ' ✓' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedEmployee && (
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline">{selectedEmployee.designation.replace(/_/g, ' ')}</Badge>
                        <span className="text-gray-500">
                          {selectedEmployee.samples > 0 ? 'Already enrolled — saving again replaces it' : 'Not enrolled yet'}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={captureSample}
                        disabled={!enrollEmployeeId || cam !== 'on' || engine !== 'ready' || samples.length >= ENROLL_MAX_SAMPLES}
                      >
                        Capture ({samples.length}/{ENROLL_MAX_SAMPLES})
                      </Button>
                      <Button variant="outline" onClick={() => setSamples([])} disabled={samples.length === 0} aria-label="Clear samples">
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <div className="flex gap-1 ml-1">
                        {Array.from({ length: ENROLL_MAX_SAMPLES }).map((_, i) => (
                          <span
                            key={i}
                            className={`h-2.5 w-2.5 rounded-full ${i < samples.length ? 'bg-green-500' : 'bg-gray-200'}`}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <Checkbox id="face-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                      <Label htmlFor="face-consent" className="text-sm font-normal leading-snug">
                        This employee has agreed to their face data being stored for attendance. Only a numeric
                        template is kept — never a photo.
                      </Label>
                    </div>

                    {enrollMsg && (
                      <p className={`text-sm ${enrollMsg.ok ? 'text-green-700' : 'text-red-700'}`}>{enrollMsg.text}</p>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={saveEnrollment}
                        disabled={saving || !enrollEmployeeId || samples.length < ENROLL_MIN_SAMPLES || !consent}
                        className="flex-1"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Save enrollment
                      </Button>
                      {selectedEmployee && selectedEmployee.samples > 0 && (
                        <Button variant="outline" onClick={removeFaceData} disabled={saving} aria-label="Delete face data">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}
