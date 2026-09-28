// Copies the three face-api model files the face-scan screen needs from
// node_modules into public/models/face so they're served by the app itself
// (no CDN, no per-request cost). Runs on `npm install` (postinstall).
// Never fails the install: if the package isn't there (e.g. a worker-only
// install) it just skips.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@vladmandic', 'face-api', 'model');
const dest = join(root, 'public', 'models', 'face');

const FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model.bin',
  'face_landmark_68_tiny_model-weights_manifest.json',
  'face_landmark_68_tiny_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

try {
  if (!existsSync(src)) {
    console.log('[face-models] @vladmandic/face-api not installed — skipping.');
  } else {
    mkdirSync(dest, { recursive: true });
    for (const f of FILES) cpSync(join(src, f), join(dest, f));
    console.log(`[face-models] copied ${FILES.length} files to public/models/face`);
  }
} catch (err) {
  console.warn('[face-models] could not copy model files:', err);
}
