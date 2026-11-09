const KEY = 'sd:settings';
const DEFAULTS = { enabled: true, off: [] };

async function getSettings() {
  const r = await chrome.storage.local.get(KEY);
  return { ...DEFAULTS, ...(r[KEY] || {}) };
}

// Pastille sur l'icône : « ON » quand la page est assombrie dans cet onglet.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'state' || !sender.tab?.id || sender.frameId !== 0) return;
  const tabId = sender.tab.id;
  chrome.action.setBadgeText({ tabId, text: msg.applied ? 'ON' : '' });
  if (msg.applied) chrome.action.setBadgeBackgroundColor({ tabId, color: '#5b3fd0' });
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-site') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  if (!host) return;
  const s = await getSettings();
  const off = s.off.includes(host) ? s.off.filter((h) => h !== host) : [...s.off, host];
  await chrome.storage.local.set({ [KEY]: { ...s, off } });
});
