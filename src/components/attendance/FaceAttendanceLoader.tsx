'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

/**
 * The face engine is browser-only (camera + WebGL), so the screen is loaded
 * client-side only — it never gets pulled into the server bundle.
 */
const FaceAttendance = dynamic(
  () => import('./FaceAttendance').then((m) => m.FaceAttendance),
  {
    ssr: false,
    loading: () => (
      <div className="p-8 flex items-center justify-center text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    ),
  },
);

export function FaceAttendanceLoader(props: {
  stores: { id: string; name: string; client: { shortName: string } }[];
}) {
  return <FaceAttendance {...props} />;
}
