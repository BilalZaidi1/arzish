// Web build: the analyzer app (app.html + hashed JS/CSS), the static marketing and legal pages, and
// self-hosted copies of React, ECharts, marked and DOMPurify, written to web-dist/ for Vercel.
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'web-dist';
const require = (await import('node:module')).createRequire(import.meta.url);
const version = (p) => require(`${p}/package.json`).version;
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'assets'), { recursive: true });
mkdirSync(join(OUT, 'vendor'), { recursive: true });

// 1. Vendor libraries, versioned file names so they can be cached for a year.
const VENDOR = [
  ['react', 'umd/react.production.min.js', 'React'],
  ['react-dom', 'umd/react-dom.production.min.js', 'ReactDOM'],
  ['echarts', 'dist/echarts.min.js', 'echarts'],
  ['marked', 'marked.min.js', 'marked'],
  ['dompurify', 'dist/purify.min.js', 'DOMPurify'],
];
const vendorTags = [];
for (const [pkg, file] of VENDOR) {
  const name = `${pkg}-${version(pkg)}.min.js`;
  copyFileSync(join('node_modules', pkg, file), join(OUT, 'vendor', name));
  vendorTags.push(`<script src="/vendor/${name}"></script>`);
}

// 2. The simulation worker, inlined into the app as a string (same as the artifact build).
const worker = await esbuild.build({ entryPoints: ['src/worker/sim.worker.ts'], bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, legalComments: 'none' });
const workerCode = worker.outputFiles[0].text;

const GLOBALS = { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM', echarts: 'echarts' };
const globalsPlugin = {
  name: 'globals',
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom|react-dom\/client|echarts)$/ }, (args) => ({ path: args.path, namespace: 'global-ext' }));
    build.onLoad({ filter: /.*/, namespace: 'global-ext' }, (args) => ({ contents: `module.exports = window[${JSON.stringify(GLOBALS[args.path])}];`, loader: 'js' }));
  },
};
const workerPlugin = {
  name: 'worker-code',
  setup(build) {
    build.onResolve({ filter: /^virtual:worker-code$/ }, () => ({ path: 'worker-code', namespace: 'worker-code' }));
    build.onLoad({ filter: /.*/, namespace: 'worker-code' }, () => ({ contents: `export default ${JSON.stringify(workerCode)};`, loader: 'js' }));
  },
};

// 3. The app bundle and stylesheet, content-hashed.
const app = await esbuild.build({
  entryPoints: ['src/web/main.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  plugins: [globalsPlugin, workerPlugin],
  define: { 'process.env.NODE_ENV': '"production"', __WEB__: 'true', global: 'window' },
});
const js = app.outputFiles[0].text;
const css = readFileSync('src/styles.css', 'utf8') + '\n' + readFileSync('src/web/web.css', 'utf8');
const jsName = `app-${hash(js)}.js`;
const cssName = `app-${hash(css)}.css`;
writeFileSync(join(OUT, 'assets', jsName), js);
writeFileSync(join(OUT, 'assets', cssName), css);

// 4. Pages. app.html gets the vendor scripts and hashed assets; static pages are copied as they are.
const appHtml = readFileSync('web/app.html', 'utf8')
  .replace('<!--CSS-->', `<link rel="stylesheet" href="/assets/${cssName}">`)
  .replace('<!--SCRIPTS-->', [...vendorTags, `<script src="/assets/${jsName}"></script>`].join('\n'));
writeFileSync(join(OUT, 'app.html'), appHtml);
for (const f of readdirSync('web')) {
  if (f === 'app.html') continue;
  copyFileSync(join('web', f), join(OUT, f));
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${OUT}/assets/${jsName} ${kb(js.length)} · ${cssName} ${kb(css.length)} · worker ${kb(workerCode.length)}`);
console.log(`pages: ${readdirSync(OUT).filter((f) => f.endsWith('.html')).join(', ')}`);
if (!existsSync(join(OUT, 'index.html'))) throw new Error('web/index.html missing');
