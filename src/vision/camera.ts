/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSimulatedMediaStream } from './frames';

export interface MediaDevicesLike {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<Array<{ kind: string; deviceId: string; label?: string }>>;
}

const REAR_CAMERA_LABEL_RE = /\b(back|rear|environment|world|external)\b|facing\s*back/i;
const FRONT_CAMERA_LABEL_RE = /\b(front|user|selfie|facetime)\b|facing\s*front/i;

export function pickRearCameraDeviceId(
  devices: Array<{ kind: string; deviceId: string; label?: string }>
): string | null {
  const videoInputs = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
  if (videoInputs.length === 0) return null;

  const explicitRear = videoInputs.find((d) => d.label && REAR_CAMERA_LABEL_RE.test(d.label));
  if (explicitRear) return explicitRear.deviceId;

  // On mobile phones with 2+ cameras when labels lack "back", browsers commonly list
  // front first and rear second, or only non-front cameras when filtering out front.
  const nonFront = videoInputs.find((d) => d.label && !FRONT_CAMERA_LABEL_RE.test(d.label));
  if (nonFront && videoInputs.some((d) => d.label && FRONT_CAMERA_LABEL_RE.test(d.label))) {
    return nonFront.deviceId;
  }

  return null;
}

const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function stopStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // ignore
  }
}

function isFrontFacingTrack(stream: MediaStream): boolean {
  try {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return false;
    const facing = videoTrack.getSettings?.().facingMode;
    if (facing === 'user') return true;
    const label = videoTrack.label || '';
    return FRONT_CAMERA_LABEL_RE.test(label) && !REAR_CAMERA_LABEL_RE.test(label);
  } catch {
    return false;
  }
}

/**
 * Acquires a rear/back camera + microphone MediaStream on mobile devices,
 * falling back cleanly to any available camera (desktops/laptops) or simulated stream.
 */
export async function acquireRearCameraStream(
  mediaDevices: MediaDevicesLike | undefined = typeof navigator !== 'undefined'
    ? navigator.mediaDevices
    : undefined,
  fallbackStreamFactory: () => MediaStream = createSimulatedMediaStream
): Promise<MediaStream> {
  if (!mediaDevices?.getUserMedia) {
    return fallbackStreamFactory();
  }

  // 1. Strictly prefer the back (environment) camera with ideal HD resolution
  try {
    return await mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: DEFAULT_AUDIO_CONSTRAINTS,
    });
  } catch {
    // Continue to relaxed exact constraint
  }

  // 2. Retry strict environment camera without resolution constraints (avoids OverconstrainedError)
  try {
    return await mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: 'environment' },
      },
      audio: DEFAULT_AUDIO_CONSTRAINTS,
    });
  } catch {
    // Continue to deviceId lookup / ideal fallback
  }

  // 3. Enumerate video devices and select rear camera explicitly if labeled
  let rearDeviceId: string | null = null;
  if (mediaDevices.enumerateDevices) {
    try {
      const devices = await mediaDevices.enumerateDevices();
      rearDeviceId = pickRearCameraDeviceId(devices);
      if (rearDeviceId) {
        return await mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: rearDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: DEFAULT_AUDIO_CONSTRAINTS,
        });
      }
    } catch {
      // Continue to ideal environment constraint
    }
  }

  // 4. Try ideal environment constraint
  try {
    const stream = await mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: DEFAULT_AUDIO_CONSTRAINTS,
    });

    // If browser still handed us the front camera despite ideal:'environment', inspect post-permission labels
    if (isFrontFacingTrack(stream) && mediaDevices.enumerateDevices) {
      try {
        const devices = await mediaDevices.enumerateDevices();
        const detectedRearId = pickRearCameraDeviceId(devices);
        if (detectedRearId) {
          stopStream(stream);
          return await mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: detectedRearId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: DEFAULT_AUDIO_CONSTRAINTS,
          });
        }
      } catch {
        // Keep the working stream if switching failed
      }
    }

    return stream;
  } catch {
    // Continue to generic hardware camera fallback
  }

  // 5. Generic hardware camera fallback (e.g. desktop/laptop single webcam)
  try {
    const genericStream = await mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    if (isFrontFacingTrack(genericStream) && mediaDevices.enumerateDevices) {
      try {
        const devices = await mediaDevices.enumerateDevices();
        const detectedRearId = pickRearCameraDeviceId(devices);
        if (detectedRearId) {
          stopStream(genericStream);
          return await mediaDevices.getUserMedia({
            video: { deviceId: { exact: detectedRearId } },
            audio: true,
          });
        }
      } catch {
        // Keep genericStream if rear switch fails
      }
    }

    return genericStream;
  } catch {
    return fallbackStreamFactory();
  }
}
