/**
 * Every test, including the end-to-end API tests on Postgres. Uses TEST_DATABASE_URL when set,
 * otherwise starts the Postgres in docker-compose.yml.
 */
import { spawnSync } from 'node:child_process';

let url = process.env.TEST_DATABASE_URL;
if (!url) {
  const up = spawnSync('docker', ['compose', 'up', '--detach', '--wait', 'db'], { stdio: 'inherit' });
  if (up.status !== 0) {
    console.error('Could not start Postgres with Docker. Set TEST_DATABASE_URL to a Postgres you can create schemas in.');
    process.exit(1);
  }
  url = 'postgres://excuses:excuses@localhost:5432/excuses';
}
const run = spawnSync('bun', ['test'], { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } });
process.exit(run.status ?? 1);
