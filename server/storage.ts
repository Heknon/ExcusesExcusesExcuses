import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

/** Where proof photos live. Keys passed in and out already carry the environment's prefix. */
export interface PhotoStore {
  newKey(roundId: number, playerId: number): string;
  ownsKey(key: string, roundId: number, playerId: number): boolean;
  uploadUrl(key: string, contentType: string): Promise<string>;
  downloadUrl(key: string, contentType: string): Promise<string>;
  size(key: string): Promise<number | null>;
  head(key: string, bytes: number): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export const UPLOAD_URL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_SECONDS = 60 * 60;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function proofKeys(prefix: string) {
  return {
    newKey: (roundId: number, playerId: number) => `${prefix}proofs/${roundId}/${playerId}/${randomUUID()}`,
    ownsKey: (key: string, roundId: number, playerId: number) =>
      key.startsWith(prefix) && new RegExp(`^proofs/${roundId}/${playerId}/${UUID}$`).test(key.slice(prefix.length)),
  };
}

/** The S3 store described by the environment, or null when no bucket is configured. */
export function photoStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PhotoStore | null {
  const bucket = env.S3_BUCKET;
  if (!bucket) return null;
  const config: S3ClientConfig = {
    region: env.S3_REGION || undefined,
    // Browsers PUT to presigned URLs without computing checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  if (env.S3_ROLE_ARN) {
    config.credentials = awsCredentialsProvider({ roleArn: env.S3_ROLE_ARN });
  } else if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    config.credentials = { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY };
  }
  if (env.S3_ENDPOINT) {
    config.endpoint = env.S3_ENDPOINT;
    config.forcePathStyle = true;
  }
  const s3 = new S3Client(config);

  return {
    ...proofKeys(env.S3_PREFIX ?? ''),

    uploadUrl: (key, contentType) =>
      getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: UPLOAD_URL_SECONDS }),

    downloadUrl: (key, contentType) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: 'inline',
          ResponseCacheControl: `private, max-age=${DOWNLOAD_URL_SECONDS}`,
        }),
        { expiresIn: DOWNLOAD_URL_SECONDS },
      ),

    async size(key) {
      try {
        const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return out.ContentLength ?? 0;
      } catch (err: any) {
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async head(key, bytes) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
      return Buffer.from((await out.Body?.transformToByteArray()) ?? []);
    },

    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
      }
    },
  };
}
