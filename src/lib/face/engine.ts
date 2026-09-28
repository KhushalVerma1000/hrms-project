'use client';

/**
 * Browser-only face engine (free: runs entirely on the user's phone).
 *
 * We import the pre-bundled ESM build by explicit path. The package's default
 * entry is a Node build that pulls in @tensorflow/tfjs-node, which must never
 * end up in the Next.js bundle. Model weights are served from
 * /models/face (copied there by scripts/copy-face-models.mjs on npm install).
 */

import { computeYaw } from './liveness';

type FaceApi = typeof import('@vladmandic/face-api/dist/face-api.esm.js');

const MODEL_URL = '/models/face';

let enginePromise: Promise<FaceApi> | null = null;

export function loadFaceEngine(): Promise<FaceApi> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const faceapi = await import('@vladmandic/face-api/dist/face-api.esm.js');
      // face-api's typings expose only a slice of tfjs; these two calls exist at runtime.
      const tf = faceapi.tf as unknown as {
        setBackend(name: string): Promise<boolean>;
        ready(): Promise<void>;
      };
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((err) => {
      enginePromise = null; // allow a retry
      throw err;
    });
  }
  return enginePromise;
}

export type FrameResult =
  | { status: 'NO_FACE' }
  | { status: 'MULTIPLE' }
  | { status: 'TOO_FAR' }
  | { status: 'OK'; descriptor: number[]; yaw: number };

export type PoseResult =
  | { status: 'NO_FACE' }
  | { status: 'MULTIPLE' }
  | { status: 'OK'; yaw: number };

/** A face narrower than this fraction of the frame is too far away to be reliable. */
const MIN_FACE_WIDTH_RATIO = 0.2;

export async function scanFrame(faceapi: FaceApi, video: HTMLVideoElement): Promise<FrameResult> {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.6 });
  const results = await faceapi
    .detectAllFaces(video, options)
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  if (results.length === 0) return { status: 'NO_FACE' };
  if (results.length > 1) return { status: 'MULTIPLE' };

  const only = results[0]!;
  if (video.videoWidth > 0 && only.detection.box.width < video.videoWidth * MIN_FACE_WIDTH_RATIO) {
    return { status: 'TOO_FAR' };
  }
  const yaw = computeYaw(only.landmarks.positions);
  if (yaw === null) return { status: 'NO_FACE' };
  return { status: 'OK', descriptor: Array.from(only.descriptor), yaw };
}

/**
 * Fast pose-only read used while a liveness challenge is running: detector +
 * landmarks, no recognition net, so it can run several times a second even
 * on a mid-range phone.
 */
export async function poseFrame(faceapi: FaceApi, video: HTMLVideoElement): Promise<PoseResult> {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const results = await faceapi.detectAllFaces(video, options).withFaceLandmarks(true);
  if (results.length === 0) return { status: 'NO_FACE' };
  if (results.length > 1) return { status: 'MULTIPLE' };
  const yaw = computeYaw(results[0]!.landmarks.positions);
  return yaw === null ? { status: 'NO_FACE' } : { status: 'OK', yaw };
}
