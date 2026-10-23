import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('test/.out', { recursive: true });
await esbuild.build({
  entryPoints: ['test/engine.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'test/.out/engine.test.mjs',
  target: 'node20',
});
execFileSync('node', ['test/.out/engine.test.mjs'], { stdio: 'inherit' });
