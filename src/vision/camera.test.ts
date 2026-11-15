import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireRearCameraStream, pickRearCameraDeviceId } from './camera';

test('pickRearCameraDeviceId prefers labeled back/rear/environment camera', () => {
  const id = pickRearCameraDeviceId([
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Default Mic' },
    { kind: 'videoinput', deviceId: 'cam-front', label: 'Front Camera (user)' },
    { kind: 'videoinput', deviceId: 'cam-back', label: 'camera2 0, facing back' },
  ]);
  assert.equal(id, 'cam-back');
});

test('pickRearCameraDeviceId picks non-front camera when front is explicitly labeled', () => {
  const id = pickRearCameraDeviceId([
    { kind: 'videoinput', deviceId: 'cam-front', label: 'FaceTime Front Camera' },
    { kind: 'videoinput', deviceId: 'cam-main', label: 'Main Lens' },
  ]);
  assert.equal(id, 'cam-main');
});

test('acquireRearCameraStream requests exact environment camera first', async () => {
  const calls: any[] = [];
  const fakeStream = { getVideoTracks: () => [], getTracks: () => [] } as unknown as MediaStream;

  const stream = await acquireRearCameraStream(
    {
      getUserMedia: async (constraints) => {
        calls.push(constraints);
        return fakeStream;
      },
    },
    () => fakeStream
  );

  assert.equal(stream, fakeStream);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0].video as any).facingMode, { exact: 'environment' });
});

test('acquireRearCameraStream switches away from front camera when post-permission labels expose rear camera', async () => {
  let stoppedFront = false;
  const frontStream = {
    getVideoTracks: () => [
      {
        label: 'Front Camera',
        getSettings: () => ({ facingMode: 'user' }),
      },
    ],
    getTracks: () => [
      {
        stop: () => {
          stoppedFront = true;
        },
      },
    ],
  } as unknown as MediaStream;

  const rearStream = {
    getVideoTracks: () => [
      {
        label: 'Back Camera',
        getSettings: () => ({ facingMode: 'environment' }),
      },
    ],
    getTracks: () => [],
  } as unknown as MediaStream;

  let permGranted = false;
  const calls: any[] = [];

  const result = await acquireRearCameraStream(
    {
      enumerateDevices: async () =>
        permGranted
          ? [
              { kind: 'videoinput', deviceId: 'cam-front', label: 'Front Camera' },
              { kind: 'videoinput', deviceId: 'cam-rear', label: 'Back Camera' },
            ]
          : [{ kind: 'videoinput', deviceId: 'cam-front', label: '' }],
      getUserMedia: async (constraints) => {
        calls.push(constraints);
        const video = constraints.video as any;
        if (video?.facingMode?.exact === 'environment') {
          throw new Error('OverconstrainedError');
        }
        if (video?.deviceId?.exact === 'cam-rear') {
          return rearStream;
        }
        permGranted = true;
        return frontStream;
      },
    },
    () => frontStream
  );

  assert.equal(result, rearStream);
  assert.equal(stoppedFront, true);
  assert.equal((calls[calls.length - 1].video as any).deviceId.exact, 'cam-rear');
});

test('acquireRearCameraStream falls back to simulated stream when all camera attempts fail', async () => {
  const simulated = { id: 'sim' } as unknown as MediaStream;
  const result = await acquireRearCameraStream(
    {
      getUserMedia: async () => {
        throw new Error('NotAllowedError');
      },
    },
    () => simulated
  );
  assert.equal(result, simulated);
});
