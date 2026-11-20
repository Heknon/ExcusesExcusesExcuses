// Produces Vercel's Build Output (v3): the built site as static files, the API as one Node function.
// https://vercel.com/docs/build-output-api/v3
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const out = '.vercel/output';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/functions/api.func`, { recursive: true });
await cp('dist', `${out}/static`, { recursive: true });

await build({
  entryPoints: ['server/vercel.ts'],
  outfile: `${out}/functions/api.func/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // pg's optional native binding and Cloudflare socket shim aren't used on Node.
  external: ['pg-native', 'cloudflare:sockets'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

await writeFile(
  `${out}/functions/api.func/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2),
);

await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Hashed build assets never change.
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/api/(.*)$', dest: '/api' },
        { handle: 'filesystem' },
        // Everything else is a client-side route.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel build output written to', out);
