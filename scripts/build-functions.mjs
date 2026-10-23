// Bundles the engine for the edge functions and writes a flattened copy of each function (every file
// in one folder, imports rewritten) to build/functions/<name>: the shape the deploy tool takes.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

await esbuild.build({
  entryPoints: ['src/engine/server.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  legalComments: 'none',
  banner: { js: '// Arzish engine for edge functions, bundled from src/engine/server.ts by scripts/build-functions.mjs. Do not edit.' },
  outfile: 'supabase/functions/_engine/engine.js',
});

const SRC = 'supabase/functions';
const OUT = 'build/functions';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'deno.json'), '{ "nodeModulesDir": "none" }\n');
const shared = readdirSync(join(SRC, '_shared'));
const FUNCTIONS = { api: false, jobs: true }; // name -> needs the engine

for (const [fn, engine] of Object.entries(FUNCTIONS)) {
  const dir = join(OUT, fn);
  mkdirSync(dir, { recursive: true });
  const files = [
    ...readdirSync(join(SRC, fn)).map((f) => [join(SRC, fn, f), f]),
    ...shared.map((f) => [join(SRC, '_shared', f), f]),
    ...(engine ? [[join(SRC, '_engine', 'engine.js'), 'engine.js']] : []),
  ];
  const seen = new Set();
  const texts = new Map();
  for (const [from, name] of files) {
    if (seen.has(name)) throw new Error(`${fn}: two files named ${name}`);
    seen.add(name);
    texts.set(name, readFileSync(from, 'utf8')
      .replace(/'\.\.\/_shared\/([\w.-]+)'/g, "'./$1'")
      .replace(/'\.\.\/_engine\/engine\.js'/g, "'./engine.js'"));
  }
  // Keep only the files the entry point reaches.
  const keep = new Set();
  const visit = (name) => {
    if (keep.has(name) || !texts.has(name)) return;
    keep.add(name);
    for (const m of texts.get(name).matchAll(/from '\.\/([\w.-]+)'/g)) visit(m[1]);
  };
  visit('index.ts');
  for (const name of keep) writeFileSync(join(dir, name), texts.get(name));
  console.log(`${dir}: ${[...keep].join(', ')}`);
}

// Single-file bundles (local imports inlined, npm: imports kept) to keep deploy payloads small.
for (const fn of Object.keys(FUNCTIONS)) {
  const out = join('build/deploy', fn, 'index.js');
  await esbuild.build({
    entryPoints: [join(OUT, fn, 'index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['npm:*', 'jsr:*'],
    minifyWhitespace: true,
    minifySyntax: true,
    legalComments: 'none',
    banner: { js: `// Arzish ${fn} function, built from supabase/functions/${fn} by scripts/build-functions.mjs. Do not edit.` },
    outfile: out,
  });
  console.log(`${out}: ${(readFileSync(out).length / 1024).toFixed(1)} KB`);
}
