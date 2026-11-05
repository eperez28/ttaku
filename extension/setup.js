const $ = id => document.getElementById(id);
let running = null, currentTab = null, micReady = false, hasKey = false, starting = false;

const isPlayerUrl = url => !!url && (url.startsWith('https://www.crunchyroll.com/watch/') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url));

function updateStart() {
  const button = $('start'), hint = $('start-hint');
  button.classList.toggle('stop', !!running);
  if (running) { button.disabled = false; button.textContent = 'Stop practice'; hint.textContent = 'Practicing on this tab. The video pauses for each Japanese line.'; return; }
  if (starting) { button.disabled = true; button.textContent = 'Starting…'; hint.textContent = ''; return; }
  button.textContent = 'Start practice';
  if (!hasKey) { button.disabled = true; hint.textContent = 'Add your Meta Model API key in Settings first.'; }
  else if (!micReady) { button.disabled = true; hint.textContent = 'Allow microphone access in Settings first.'; }
  else if (!isPlayerUrl(currentTab?.url)) { button.disabled = true; hint.textContent = 'Open a Crunchyroll episode (or the local test page), then start.'; }
  else { button.disabled = false; hint.textContent = 'Ttaku listens, pauses for each Japanese line, and resumes when you repeat it.'; }
  $('key-banner').hidden = hasKey;
}
function showError(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
function keyStatus(message) { $('key-status').textContent = message; }

function wordRow(word, count) {
  const row = document.createElement('div'); row.className = 'word';
  const head = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = word.romaji || '';
  const japanese = document.createElement('span'); japanese.className = 'reading'; japanese.textContent = word.japanese || '';
  head.append(strong, japanese); row.append(head);
  if (count) { const c = document.createElement('span'); c.className = 'count'; c.textContent = '×' + count; row.append(c); }
  if (word.meaning) { const def = document.createElement('div'); def.className = 'definition'; def.textContent = word.meaning; row.append(def); }
  return row;
}
function emptyNote(text) { const p = document.createElement('div'); p.className = 'empty'; p.textContent = text; return p; }

async function load() {
  const stored = await chrome.storage.local.get(['micReady', 'bank', 'spokenBank', 'progress', 'lastError', 'showJapanese', 'diag']);
  micReady = !!stored.micReady;
  const bank = stored.bank || [], spoken = [...(stored.spokenBank || [])].sort((a, b) => (b.count || 0) - (a.count || 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
  const progress = stored.progress || { phrases: 0 };
  $('mic').textContent = micReady ? 'Allowed' : 'Allow access'; $('mic').classList.toggle('enabled', micReady);
  $('japanese-toggle').setAttribute('aria-checked', String(!!stored.showJapanese));
  // Show a stored error once, then clear it so it does not haunt every open.
  showError(stored.lastError || '');
  if (stored.lastError) chrome.storage.local.set({ lastError: '' }).catch(() => {});

  $('spoken').replaceChildren(...(spoken.length ? spoken.slice(0, 50).map(w => wordRow(w, w.count)) : [emptyNote('Words from lines you finish will collect here automatically.')]));
  $('words').replaceChildren();
  if (!bank.length) $('words').append(emptyNote('Tap a word under a line during practice to save it here.'));
  for (const word of bank) {
    const row = wordRow(word);
    if (word.context?.url?.startsWith('https://www.crunchyroll.com/')) { const a = document.createElement('a'); a.textContent = '↗'; a.title = 'Open the episode'; a.href = word.context.url; a.target = '_blank'; row.append(a); }
    $('words').append(row);
  }
  $('export').hidden = !bank.length && !spoken.length;
  $('progress').textContent = progress.phrases + ' ' + (progress.phrases === 1 ? 'line' : 'lines') + ' practiced';

  const status = await chrome.runtime.sendMessage({ target: 'worker', type: 'status' }); running = status?.session || null;
  const keyState = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-status' }); hasKey = !!keyState?.hasKey;
  keyStatus(hasKey ? 'Key saved on this device. Paste a new key and Save to replace it, or Clear to remove it.' : 'No key saved. Paste your Meta Model API key and choose Save.');
  [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  $('episode-title').textContent = isPlayerUrl(currentTab?.url) ? (currentTab.title || 'Video').replace(/ - Watch on Crunchyroll$/, '') : 'Open a Crunchyroll episode';

  if (stored.diag) {
    const ago = Math.max(0, Math.round((Date.now() - (stored.diag.at || 0)) / 1000));
    $('helper').hidden = false;
    $('helper').textContent = 'Sound check — loudest heard: ' + (stored.diag.peak || 0).toFixed(2) + ' · clips sent: ' + (stored.diag.clips || 0) + ' · last: ' + (stored.diag.outcome || '') + ' (' + ago + 's ago)';
  }
  updateStart();
}

$('start').onclick = async () => {
  showError('');
  if (running) {
    const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'stop' });
    if (r?.error) showError(r.error);
    await load(); return;
  }
  starting = true; updateStart();
  try {
    const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'start', tabId: currentTab.id });
    if (r?.error) throw Error(r.error);
    window.close();
  } catch (e) { showError(e.message); starting = false; await load(); }
};
$('mic').onclick = () => chrome.runtime.sendMessage({ target: 'worker', type: 'permission' });
$('key-save').onclick = async () => {
  const value = $('meta-key').value; $('meta-key').value = '';
  if (!value.trim()) { keyStatus('Paste a key first.'); return; }
  const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-save', key: value });
  if (r?.error) { keyStatus(r.error); return; }
  hasKey = true; keyStatus('Key saved on this device. Paste a new key and Save to replace it, or Clear to remove it.'); updateStart();
};
$('key-clear').onclick = async () => {
  $('meta-key').value = '';
  await chrome.runtime.sendMessage({ target: 'worker', type: 'key-clear' });
  hasKey = false; running = null; keyStatus('Key cleared. Active Meta sessions were ended.'); updateStart();
};
$('key-test').onclick = async () => {
  keyStatus('Testing connection…');
  const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-test' });
  keyStatus(r?.error ? r.error : 'Connection works. Meta accepted that key.');
};
$('japanese-toggle').onclick = async () => { const v = $('japanese-toggle').getAttribute('aria-checked') !== 'true'; await chrome.storage.local.set({ showJapanese: v }); $('japanese-toggle').setAttribute('aria-checked', String(v)); };
function showView(view) {
  for (const name of ['practice', 'words', 'settings']) $(name + '-view').hidden = name !== view;
  $('heading').textContent = { practice: 'Ttaku', words: 'Word bank', settings: 'Settings' }[view];
  $('back').hidden = view === 'practice'; $('tools').hidden = view !== 'practice';
  if (view !== 'practice') $('back').focus();
}
$('open-words').onclick = () => showView('words');
$('open-settings').onclick = () => showView('settings');
$('go-settings').onclick = () => showView('settings');
$('back').onclick = () => showView('practice');
$('export').onclick = async () => {
  const { bank = [], spokenBank = [] } = await chrome.storage.local.get(['bank', 'spokenBank']);
  const blob = new Blob([JSON.stringify({ saved: bank, spoken: spokenBank }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ttaku-word-bank.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
load();
