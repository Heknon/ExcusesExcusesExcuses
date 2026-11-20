import { migrate } from '../server/db.ts';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL_UNPOOLED or DATABASE_URL');
  process.exit(1);
}
const applied = await migrate(url);
console.log(applied.length ? `Applied ${applied.join(', ')}` : 'Schema is up to date');
