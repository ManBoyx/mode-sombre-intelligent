// Test de bout en bout : vrai Helium sans fenêtre, vraies captures d'écran, couleurs mesurées pixel par pixel.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = process.env.HELIUM || '/opt/helium/helium';
const PORT = 9334, SITE_PORT = 8766, W = 1000, H = 700;
const profile = mkdtempSync(join(tmpdir(), 'sombre-test-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const cleanup = () => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

procs.push(spawn('python3', ['-I', '-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1'], { cwd: join(root, 'test/site'), stdio: 'ignore' }));
procs.push(spawn(BIN, ['--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--load-extension=${root}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' }));

async function until(fn, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fn(); if (r) return r; } catch {}
    if (Date.now() - t0 > ms) throw new Error('délai dépassé : ' + what);
    await sleep(150);
  }
}

const ver = await until(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(), 'démarrage du navigateur');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const waiting = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (process.env.DEBUG && d.method === 'Runtime.consoleAPICalled' && String(d.params.args?.[0]?.value || '').startsWith('[sd]')) console.log(d.params.args.map((a) => a.value).join(' '));
  if (process.env.DEBUG && d.method === 'Runtime.exceptionThrown') console.log('PAGE>', JSON.stringify({ e: d.params.exceptionDetails.exception?.description?.slice(0, 400), u: d.params.exceptionDetails.url })); if (d.id && waiting.has(d.id)) { const [res, rej] = waiting.get(d.id); waiting.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } });
const cdp = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  const timer = setTimeout(() => { waiting.delete(id); rej(new Error('CDP sans réponse (30 s) : ' + method)); }, 30000);
  waiting.set(id, [(r) => { clearTimeout(timer); res(r); }, (e) => { clearTimeout(timer); rej(e); }]);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

async function open(url) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp('Page.bringToFront', {}, sessionId).catch(() => {});
  const ev = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  await until(async () => (await ev('document.readyState')) === 'complete', 'onglet vierge prêt');
  for (let i = 0; i < 4; i++) { const nav = await cdp('Page.navigate', { url }, sessionId); if (!nav.errorText) break; await sleep(400); }
  await until(async () => (await ev('location.href')) !== 'about:blank', 'chargement ' + url);
  return { sessionId, targetId, ev };
}

// ---- capture + décodage PNG (8 bits, sans entrelacement)
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; assert.equal(data[8], 8); assert.equal(data[12], 0); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const out = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2]; out[o + 3] = 255; }
    prev = line;
  }
  return { w, h, px: out };
}
async function shot(page) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  return decodePNG(Buffer.from(data, 'base64'));
}
const at = (img, x, y) => { const o = (Math.round(y) * img.w + Math.round(x)) * 4; return [img.px[o], img.px[o + 1], img.px[o + 2]]; };
const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const rectOf = async (page, id) => page.ev(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const maxLumIn = (img, r) => { let m = 0; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) m = Math.max(m, lum(at(img, x, y))); return m; };
// Les zones restaurées gardent leurs couleurs, avec le même léger adoucissement que le reste de la page (contraste 0.9, luminosité 0.95).
const soften = (c) => c.map((v) => Math.round(((v / 255 - 0.5) * 0.9 + 0.5) * 0.95 * 255));
const same = (a, b) => a.w === b.w && a.h === b.h && Buffer.compare(a.px, b.px) === 0;

async function settle(page, ms = 1800) { await sleep(ms); }

const extId = await until(async () => {
  const { targetInfos } = await cdp('Target.getTargets');
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('background.js'));
  return sw && new URL(sw.url).host;
}, 'extension chargée');
console.log('ext id:', extId);
const ext = await open(`chrome-extension://${extId}/popup.html`);
const setSettings = (s) => ext.ev(`chrome.storage.local.set({'sd:settings': ${JSON.stringify(s)}}).then(()=>1)`);

// Mode « captures de vrais sites » : SHOT_URLS=url1,url2 SHOT_DIR=dossier node test/browser.test.mjs
if (process.env.SHOT_URLS) {
  let i = 0;
  if (process.env.SHOT_OFF) await setSettings({ enabled: false, off: [] });
  for (const u of process.env.SHOT_URLS.split(',')) {
    let p;
    try {
      p = await open(u);
      await sleep(5000);
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, p.sessionId);
      writeFileSync(join(process.env.SHOT_DIR, `site${i}.png`), Buffer.from(data, 'base64'));
    } catch (e) { console.log(i++, u, 'ÉCHEC DE CAPTURE (navigateur de test) :', e.message.slice(0, 60)); continue; }
    if (process.env.DEBUG) console.log('ÉCHANTILLONS', await p.ev(`(() => { const out = []; const w = innerWidth, h = innerHeight;
      for (const fy of [0.1, 0.5, 0.9]) for (const fx of [0.1, 0.5, 0.9]) {
        out.push(fx + ',' + fy + ': ' + document.elementsFromPoint(w * fx, h * fy).slice(0, 6).map((e) => e.tagName + '[bg ' + getComputedStyle(e).backgroundColor + (getComputedStyle(e).backgroundImage !== 'none' ? ' +IMG' : '') + ' | txt ' + getComputedStyle(e).color + ']').join(' > '));
      }
      return out.join('\\n') + '\\ncolorScheme=' + getComputedStyle(document.documentElement).colorScheme + ' w=' + w + ' h=' + h + ' pref=' + matchMedia('(prefers-color-scheme: dark)').matches; })()`));
    console.log(i++, u, await p.ev(`JSON.stringify({appliqué: document.documentElement.getAttribute('data-sd') === 'on', blocs_gardés: document.querySelectorAll('[data-sd-keep]').length})`));
  }
  cleanup(); process.exit(0);
}

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok  -', name); };
const URL_ = (f) => `http://127.0.0.1:${SITE_PORT}/${f}`;

await t('page claire -> assombrie (fond sombre, texte clair)', async () => {
  const p = await open(URL_('light.html')); await settle(p);
  const img = await shot(p);
  const bg = at(img, 900, 650);
  assert.ok(lum(bg) < 0.12, `fond doit être sombre, obtenu ${bg}`);
  const h = await rectOf(p, 'h');
  assert.ok(maxLumIn(img, { x: h.x, y: h.y, w: 700, h: h.h }) > 0.75, 'le texte doit devenir clair');
  assert.equal(await p.ev(`document.documentElement.getAttribute('data-sd')`), 'on');
});

await t('image et photo de fond : intactes (couleurs d\'origine)', async () => {
  const p = await open(URL_('light.html')); await settle(p);
  const img = await shot(p);
  const a = await rectOf(p, 'img'), b = await rectOf(p, 'photo');
  const px1 = at(img, a.x + a.w / 2, a.y + a.h / 2), px2 = at(img, b.x + b.w / 2, b.y + b.h / 2);
  assert.ok(near(px1, soften([255, 106, 0]), 12), `image orange (adoucie) attendue ${soften([255, 106, 0])}, obtenu ${px1}`);
  // couleur très saturée : la rotation de teinte du filtre écrête un peu, la teinte doit rester verte et proche
  assert.ok(near(px2, soften([46, 204, 113]), 28) && px2[1] > px2[0] + 80 && px2[1] > px2[2] + 60, `fond-image vert (adouci) attendu ~${soften([46, 204, 113])}, obtenu ${px2}`);
});

await t('bloc DÉJÀ sombre dans une page claire : laissé tel quel', async () => {
  const p = await open(URL_('light.html')); await settle(p);
  const img = await shot(p);
  const c = await rectOf(p, 'code');
  const px = at(img, c.x + c.w - 15, c.y + c.h - 12);
  // il reste sombre et bleuté (un bleu très saturé est un peu grisé par la rotation de teinte du filtre)
  assert.ok(near(px, soften([16, 26, 58]), 22) && lum(px) < 0.2 && px[2] > px[0] + 12, `bleu nuit sombre attendu ~${soften([16, 26, 58])}, obtenu ${px}`);
  assert.ok(maxLumIn(img, { x: c.x + 20, y: c.y + 20, w: 200, h: 25 }) > 0.8, 'le texte clair du bloc doit rester clair');
  assert.equal(await p.ev(`document.getElementById('code').hasAttribute('data-sd-keep')`), true);
});

await t('page DÉJÀ sombre : strictement inchangée (pixel pour pixel)', async () => {
  await setSettings({ enabled: false, off: [] });
  const off = await open(URL_('dark.html')); await settle(off, 1200);
  const ref = await shot(off);
  await setSettings({ enabled: true, off: [] });
  const on = await open(URL_('dark.html')); await settle(on);
  const img = await shot(on);
  assert.equal(await on.ev(`document.documentElement.hasAttribute('data-sd')`), false, 'aucun filtre ne doit être posé');
  assert.ok(same(ref, img), 'la capture doit être identique à celle sans extension');
  const card = await rectOf(on, 'card');
  assert.ok(near(at(img, card.x + card.w - 10, card.y + card.h - 10), [255, 255, 255], 2), 'la carte blanche voulue par le site reste blanche');
});

await t('le site passe en sombre tout seul : l\'extension se retire', async () => {
  const p = await open(URL_('toggle.html'));
  await sleep(700);
  assert.equal(await p.ev(`document.documentElement.getAttribute('data-sd')`), 'on', 'page claire au départ : assombrie');
  await until(async () => (await p.ev(`document.documentElement.hasAttribute('data-sd')`)) === false, 'retrait du filtre', 9000);
  await sleep(400);
  const img = await shot(p);
  assert.ok(near(at(img, 900, 650), [24, 24, 24], 2), `le fond natif #181818 doit apparaître tel quel, obtenu ${at(img, 900, 650)}`);
});

await t('désactivation sur un site, en direct, sans recharger', async () => {
  const p = await open(URL_('light.html')); await settle(p, 1200);
  assert.equal(await p.ev(`document.documentElement.getAttribute('data-sd')`), 'on');
  await setSettings({ enabled: true, off: ['127.0.0.1'] });
  await until(async () => (await p.ev(`document.documentElement.hasAttribute('data-sd')`)) === false, 'retrait en direct');
  await sleep(300);
  const img = await shot(p);
  assert.ok(near(at(img, 900, 650), [255, 255, 255], 2), 'fond blanc d\'origine');
  assert.equal(await p.ev(`document.querySelectorAll('[data-sd-keep]').length`), 0, 'aucune trace laissée dans la page');
  await setSettings({ enabled: true, off: [] });
});

await t('réactivation en direct', async () => {
  const p = await open(URL_('light.html')); await settle(p, 1200);
  await until(async () => (await p.ev(`document.documentElement.getAttribute('data-sd')`)) === 'on', 'réapplication');
  await setSettings({ enabled: false, off: [] });
  await until(async () => (await p.ev(`document.documentElement.hasAttribute('data-sd')`)) === false, 'extension coupée');
  await setSettings({ enabled: true, off: [] });
  await until(async () => (await p.ev(`document.documentElement.getAttribute('data-sd')`)) === 'on', 'extension réactivée');
});

await t('mémoire du site : aucun éclair à la visite suivante', async () => {
  await open(URL_('light.html'));
  await sleep(1500);
  const seen = await ext.ev(`chrome.storage.local.get('sd:seen').then(r => r['sd:seen'])`);
  assert.ok(seen && seen['127.0.0.1'], 'le site est mémorisé');
});

console.log(`\n${n} tests navigateur OK`);
cleanup();
process.exit(0);
