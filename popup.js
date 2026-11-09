const KEY = 'sd:settings';
const $ = (id) => document.getElementById(id);
let settings = { enabled: true, off: [] };
let host = '';

async function load() {
  settings = { enabled: true, off: [], ...((await chrome.storage.local.get(KEY))[KEY] || {}) };
  $('enabled').checked = settings.enabled;
}
const save = () => chrome.storage.local.set({ [KEY]: settings });

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { host = new URL(tab.url).hostname; } catch { host = ''; }
  const status = $('status'), btn = $('site');
  $('host').textContent = host || 'Page non gérée';
  if (!host || !/^https?:/.test(tab.url)) {
    status.textContent = 'Le mode sombre ne s\'applique pas à cette page.';
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const off = settings.off.includes(host);
  btn.textContent = off ? 'Réactiver sur ce site' : 'Désactiver sur ce site';
  if (!settings.enabled) { status.textContent = 'Extension désactivée.'; return; }
  if (off) { status.textContent = 'Désactivé sur ce site : la page reste telle quelle.'; return; }
  let st = null;
  try { st = await chrome.tabs.sendMessage(tab.id, { type: 'status' }, { frameId: 0 }); } catch {}
  if (!st) status.textContent = 'Recharge la page pour activer le mode sombre.';
  else if (st.applied) status.textContent = `Page claire : assombrie${st.keepCount ? ` (${st.keepCount} bloc${st.keepCount > 1 ? 's' : ''} ou image${st.keepCount > 1 ? 's' : ''} laissé${st.keepCount > 1 ? 's' : ''} tel${st.keepCount > 1 ? 's' : ''} quel${st.keepCount > 1 ? 's' : ''})` : ''}.`;
  else if (st.pageDark) status.textContent = 'Page déjà sombre : non modifiée.';
  else status.textContent = 'Analyse en cours…';
}

$('enabled').addEventListener('change', async () => {
  settings.enabled = $('enabled').checked;
  await save();
  refresh();
});
$('site').addEventListener('click', async () => {
  if (!host) return;
  settings.off = settings.off.includes(host) ? settings.off.filter((h) => h !== host) : [...settings.off, host];
  await save();
  setTimeout(refresh, 400);
});

load().then(refresh);
