/**
 * One-off: move proof photos stored in the database into the photo store, then clear their bytes.
 * Safe to re-run; it picks up only photos still in the database.
 *   bun scripts/move-proofs-to-s3.ts
 */
import pg from 'pg';
import { photoStoreFromEnv } from '../server/storage.ts';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const store = photoStoreFromEnv();
if (!url || !store) {
  console.error('Set DATABASE_URL (or DATABASE_URL_UNPOOLED) and S3_BUCKET, S3_REGION, S3_PREFIX');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
let moved = 0;
try {
  for (;;) {
    const { rows } = await client.query(
      'SELECT id, round_id, player_id, mime, bytes FROM proofs WHERE object_key IS NULL AND bytes IS NOT NULL ORDER BY id LIMIT 20',
    );
    if (!rows.length) break;
    for (const row of rows) {
      const key = store.newKey(row.round_id, row.player_id);
      await store.put(key, row.bytes, row.mime);
      await client.query('UPDATE proofs SET object_key = $2, bytes = NULL WHERE id = $1', [row.id, key]);
      moved++;
    }
    console.log(`Moved ${moved}`);
  }
} finally {
  await client.end();
}
console.log(`Done: ${moved} photos moved`);
