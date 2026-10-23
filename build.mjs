// Build: bundles the simulation worker to a string, bundles the app (React, ECharts,
// marked and DOMPurify stay external as CDN globals), and inlines both plus CSS into
// one self-contained HTML page at dist/arzish.html.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const prod = !process.argv.includes('--dev');

const GLOBALS = {
  'react': 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
  'echarts': 'echarts',
};

const globalsPlugin = {
  name: 'globals',
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom|react-dom\/client|echarts)$/ }, (args) => ({
      path: args.path,
      namespace: 'global-ext',
    }));
    build.onLoad({ filter: /.*/, namespace: 'global-ext' }, (args) => ({
      contents: `module.exports = window[${JSON.stringify(GLOBALS[args.path])}];`,
      loader: 'js',
    }));
  },
};

// 1. Worker bundle -> string
const worker = await esbuild.build({
  entryPoints: ['src/worker/sim.worker.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify: prod,
  legalComments: 'none',
});
const workerCode = worker.outputFiles[0].text;

const workerPlugin = {
  name: 'worker-code',
  setup(build) {
    build.onResolve({ filter: /^virtual:worker-code$/ }, () => ({ path: 'worker-code', namespace: 'worker-code' }));
    build.onLoad({ filter: /.*/, namespace: 'worker-code' }, () => ({
      contents: `export default ${JSON.stringify(workerCode)};`,
      loader: 'js',
    }));
  },
};

// 2. App bundle
const app = await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify: prod,
  legalComments: 'none',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  plugins: [globalsPlugin, workerPlugin],
  define: { 'process.env.NODE_ENV': '"production"', __WEB__: 'false' },
});
let appCode = app.outputFiles[0].text;
// Guard against a literal closing script tag inside the inlined bundle.
appCode = appCode.replace(/<\/script/gi, '<\\/script');

const css = readFileSync('src/styles.css', 'utf8');
const template = readFileSync('src/template.html', 'utf8');
const html = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__APP__*/', () => appCode);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/arzish.html', html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`dist/arzish.html written (${kb} KB; worker ${(workerCode.length / 1024).toFixed(1)} KB)`);
