// Prints the environment facts recorded in ENVIRONMENT.md: tool versions, headless WebGL2, network reachability.
// Usage: npm run env:check
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const sh = (c) => {
  try {
    return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')[0];
  } catch {
    return 'not found';
  }
};
console.log(
  'node',
  process.version,
  '| npm',
  sh('npm -v'),
  '|',
  sh('git --version'),
  '|',
  sh('python3 --version'),
);
for (const t of [
  'gh --version',
  'vercel --version',
  'toktx --version',
  'gltf-transform --version',
  'blender --version',
])
  console.log(t.split(' ')[0].padEnd(15), sh(t));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const gl = await page.evaluate(() => {
  const g = document.createElement('canvas').getContext('webgl2');
  if (!g) return 'WebGL2 unavailable';
  const d = g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'WebGL2 (renderer hidden)';
});
console.log('chromium', browser.version(), '| WebGL2:', gl);
await browser.close();

const hosts = [
  'https://github.com/',
  'https://registry.npmjs.org/',
  'https://api.polyhaven.com/types',
  'https://dl.polyhaven.org/',
  'https://ambientcg.com/api/v2/full_json?limit=1',
  'https://quaternius.com/',
  'https://kenney.nl/',
  'https://sketchfab.com/',
  'https://fonts.googleapis.com/css2?family=Inter',
  'https://api.vercel.com/',
];
for (const url of hosts) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000) });
    console.log(String(r.status).padEnd(5), url);
  } catch (e) {
    console.log('FAIL ', url, e.cause?.code ?? e.message);
  }
}
