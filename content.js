// Mode sombre intelligent.
//  1. Page déjà sombre            -> on ne touche à rien.
//  2. Page claire                 -> inversion de la page (filtre sur <html>).
//  3. Blocs déjà sombres, images, -> on leur applique le filtre inverse : ils gardent leur apparence d'origine.
//     vidéos, iframes
//  4. Si le site passe lui-même en sombre plus tard, on se retire.
// Les couleurs calculées de la page ne sont jamais modifiées : la détection reste donc valable avec le filtre actif.
(() => {
  if (!/^https?:$/.test(location.protocol)) return;

  const IS_TOP = window === window.top;
  const HOST = location.hostname;
  const KEY = 'sd:settings', SEEN = 'sd:seen';

  const B = 0.95, C = 0.9; // adoucit le noir et le blanc purs
  const FILTER = `invert(1) hue-rotate(180deg) contrast(${C}) brightness(${B})`;
  // Inverse exact de FILTER : mêmes étapes, dans l'ordre inverse.
  const UNFILTER = `brightness(${(1 / B).toFixed(4)}) contrast(${(1 / C).toFixed(4)}) hue-rotate(180deg) invert(1)`;

  let settings = { enabled: true, off: [] };
  let seen = {};
  let applied = false, pageDark = null, keepCount = 0;
  let htmlBg = '#ffffff';
  let ready = false;

  // Feuille adoptée : non soumise à la politique CSP de la page.
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const root = document.documentElement;

  const css = () =>
    `html[data-sd="on"]{filter:${FILTER}!important;${htmlBg ? `background-color:${htmlBg}!important;` : ''}}` +
    `html[data-sd="on"] [data-sd-keep]{filter:${UNFILTER}!important;}`;

  // ------------------------------------------------------------ couleurs
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  // Convertit n'importe quelle couleur CSS (rgb, oklch, color(), ...) en [r, g, b, alpha].
  function rgba(str) {
    let v = colorCache.get(str);
    if (v) return v;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = str;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    v = [d[0], d[1], d[2], d[3] / 255];
    if (colorCache.size > 2000) colorCache.clear();
    colorCache.set(str, v);
    return v;
  }
  const luma = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

  // ------------------------------------------------------------ détection : la page est-elle déjà sombre ?
  function canvasIsDark() {
    const cs = getComputedStyle(root).colorScheme || '';
    if (cs.includes('dark') && !cs.includes('light')) return true;
    return cs.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  const NEUTRAL = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT', 'PICTURE', 'SVG', 'svg']);

  function detectDark() {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return false;
    // Signal direct : le fond de la page elle-même (corps, sinon <html>) est-il déjà sombre ?
    const base = [document.body, root].map((e) => e && rgba(getComputedStyle(e).backgroundColor)).find((c) => c && c[3] >= 0.9);
    if (base && luma(base) < 0.25) return true;
    const fallback = canvasIsDark() ? 0.05 : 1;
    let score = 0, valid = 0;
    const textLuma = []; // couleur du texte aux points d'échantillonnage : sert quand l'écran est couvert d'images
    for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        let l = fallback, skip = false, seenText = false;
        for (const el of document.elementsFromPoint(w * fx, h * fy)) {
          if (NEUTRAL.has(el.tagName)) { skip = true; break; } // photo, vidéo... : ne dit rien du thème
          const cs = getComputedStyle(el);
          if (!seenText && el !== root) { textLuma.push(luma(rgba(cs.color))); seenText = true; }
          const c = rgba(cs.backgroundColor);
          if (c[3] >= 0.6) { l = luma(c); break; }
          if (cs.backgroundImage !== 'none' && el !== root) { skip = true; break; }
        }
        if (skip) continue;
        valid++;
        score += l < 0.35 ? 1 : l < 0.6 ? 0.5 : 0;
      }
    }
    // Trop peu de fonds mesurables (page couverte d'images) : on se fie à la couleur du texte (texte clair = page sombre).
    if (valid < 8 && textLuma.length >= 5) {
      textLuma.sort((a, b) => a - b);
      const median = textLuma[textLuma.length >> 1];
      if (median > 0.6) return true;
      if (valid === 0) return false;
    }
    return valid > 0 && score / valid >= 0.6;
  }

  // ------------------------------------------------------------ blocs à laisser tels quels
  const ALWAYS_KEEP = new Set(['VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT', 'PICTURE']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'HEAD', 'TEMPLATE', 'BR', 'WBR']);

  function isKeep(el) {
    const tag = el.tagName;
    if (SKIP.has(tag)) return false;
    if (ALWAYS_KEEP.has(tag)) return true;
    if (tag === 'IMG') {
      // photos et images raster : intactes. Les SVG (icônes, logos) sont inversés, sauf les grandes illustrations.
      const src = el.currentSrc || el.src || '';
      const svg = /\.svg([?#]|$)/i.test(src) || src.startsWith('data:image/svg');
      return !svg || Math.max(el.clientWidth, el.clientHeight) >= 200;
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return false;
    if (cs.backgroundImage.includes('url(')) {
      const r = el.getBoundingClientRect();
      return r.width >= 32 && r.height >= 32;
    }
    const c = rgba(cs.backgroundColor);
    if (c[3] >= 0.85 && luma(c) < 0.3) { // fond déjà sombre
      const r = el.getBoundingClientRect();
      return r.width >= 24 && r.height >= 16;
    }
    return false;
  }

  const stack = [];
  let scanTimer = 0;
  function visit(el) {
    if (el.nodeType !== 1 || !el.isConnected || el.hasAttribute('data-sd-keep')) return;
    if (isKeep(el)) { el.setAttribute('data-sd-keep', ''); keepCount++; return; }
    if (el instanceof SVGElement) return;
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  }
  function runScan() {
    scanTimer = 0;
    if (!applied) { stack.length = 0; return; }
    const t0 = performance.now();
    let i = 0;
    while (stack.length) {
      visit(stack.pop());
      if ((++i & 63) === 0 && performance.now() - t0 > 8) { scanTimer = setTimeout(runScan, 20); return; }
    }
    report();
  }
  function scheduleScan(node) {
    if (!applied) return;
    stack.push(node);
    if (!scanTimer) scanTimer = setTimeout(runScan, 60);
  }
  function clearKeep() {
    stack.length = 0;
    for (const e of document.querySelectorAll('[data-sd-keep]')) e.removeAttribute('data-sd-keep');
    keepCount = 0;
  }

  // ------------------------------------------------------------ application
  function naturalHtmlBg() {
    // Le fond du canvas vient de <html>, sinon de <body> : on le reproduit pour qu'il soit inversé lui aussi.
    const had = root.hasAttribute('data-sd');
    if (had) root.removeAttribute('data-sd');
    let bg = '#ffffff';
    if (rgba(getComputedStyle(root).backgroundColor)[3] > 0.05) bg = '';
    else if (document.body && rgba(getComputedStyle(document.body).backgroundColor)[3] > 0.05) bg = getComputedStyle(document.body).backgroundColor;
    if (had) root.setAttribute('data-sd', 'on');
    return bg;
  }

  function setApplied(on) {
    if (on === applied) return;
    applied = on;
    if (on) {
      sheet.replaceSync(css());
      root.setAttribute('data-sd', 'on');
    } else {
      root.removeAttribute('data-sd');
      sheet.replaceSync('');
      clearKeep();
    }
    report();
  }

  let lastReport = '';
  let reportTimer = 0;
  function report() {
    if (!IS_TOP) return;
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      const s = JSON.stringify([applied, pageDark, keepCount]);
      if (s === lastReport) return;
      lastReport = s;
      try { chrome.runtime.sendMessage({ type: 'state', applied, pageDark, keepCount }, () => void chrome.runtime.lastError); } catch {}
    }, 200);
  }

  function remember(v) {
    if (!IS_TOP || seen[HOST] === v) return;
    delete seen[HOST];
    seen[HOST] = v;
    const keys = Object.keys(seen);
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete seen[k];
    try { chrome.storage.local.set({ [SEEN]: seen }); } catch {}
  }

  function isOff() { return !settings.enabled || settings.off.includes(HOST); }

  function evaluate() {
    if (!ready) return;
    if (isOff()) { pageDark = null; setApplied(false); return; }
    pageDark = detectDark();
    if (pageDark) {
      setApplied(false);
    } else {
      const bg = naturalHtmlBg();
      if (!applied || bg !== htmlBg) { htmlBg = bg; if (applied) sheet.replaceSync(css()); }
      setApplied(true);
      scheduleScan(root);
    }
    remember(pageDark ? 'dark' : 'light');
    report();
  }

  // ------------------------------------------------------------ déclencheurs
  let evalTimer = 0;
  const evaluateSoon = (ms = 350) => { clearTimeout(evalTimer); evalTimer = setTimeout(evaluate, ms); };

  function startObservers() {
    const attrs = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-bs-theme', 'data-color-mode', 'data-mode', 'data-color-scheme'] };
    const mo = new MutationObserver(() => evaluateSoon());
    mo.observe(root, attrs);
    if (document.body) mo.observe(document.body, attrs);
    // nouveaux éléments : on ne les analyse que si le filtre est actif
    new MutationObserver((muts) => {
      if (!applied) return;
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) scheduleScan(n);
    }).observe(root, { childList: true, subtree: true });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => evaluateSoon(100));
    addEventListener('popstate', () => evaluateSoon(300));
    addEventListener('hashchange', () => evaluateSoon(300));
  }

  function onDomReady() {
    evaluate();
    startObservers();
    addEventListener('load', () => evaluateSoon(100));
    setTimeout(evaluate, 900);
    setTimeout(evaluate, 2600);
  }

  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !c[KEY]) return;
    settings = { enabled: true, off: [], ...(c[KEY].newValue || {}) };
    if (ready) evaluate();
  });

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg?.type === 'status' && IS_TOP) {
      send({ applied, pageDark, keepCount, host: HOST });
    }
  });

  chrome.storage.local.get([KEY, SEEN], (r) => {
    settings = { enabled: true, off: [], ...(r[KEY] || {}) };
    seen = r[SEEN] || {};
    // Anti-éclair : si ce site était clair la dernière fois, on assombrit tout de suite, avant la première image.
    if (IS_TOP && !isOff() && seen[HOST] === 'light') setApplied(true);
    ready = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
    else onDomReady();
  });
})();
