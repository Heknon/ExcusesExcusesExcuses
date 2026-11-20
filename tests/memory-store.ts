import { proofKeys, type PhotoStore } from '../server/storage.ts';

/** A PhotoStore in memory. Tests upload with put(), standing in for the browser's PUT to S3. */
export function memoryStore(prefix = 'test/') {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const store: PhotoStore = {
    ...proofKeys(prefix),
    uploadUrl: async (key) => `https://photos.test/upload/${key}`,
    downloadUrl: async (key) => `https://photos.test/${key}`,
    size: async (key) => objects.get(key)?.body.length ?? null,
    head: async (key, bytes) => (objects.get(key)?.body ?? Buffer.alloc(0)).subarray(0, bytes),
    put: async (key, body, type) => void objects.set(key, { body, type }),
    remove: async (keys) => keys.forEach((k) => objects.delete(k)),
  };
  return { store, objects };
}
