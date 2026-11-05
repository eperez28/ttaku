const $ = id => document.getElementById(id);
let running = null, currentTab = null, micReady = false, hasKey = false, starting = false, practiceMode = 'rehearse';

const isPlayerUrl = url => !!url && (url.startsWith('https://www.crunchyroll.com/watch/') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url));

// Never show raw browser/engine errors to people.
function friendlyError(message = '') {
  if (/Meta|API key|microphone|Crunchyroll|No video|already running|episode/i.test(message)) return message;
  if (/permission|denied|NotAllowed/i.test(message)) return 'Microphone access was blocked. Allow it in Settings, then try again.';
  return 'Something went wrong. Try again in a moment.';
}

function currentStep() {
  if (running) return 'running';
  if (!hasKey) return 'key';
  if (!micReady) return 'mic';
  if (!isPlayerUrl(currentTab?.url)) return 'episode';
  return 'ready';
}
function updateStart() {
  const button = $('start');
  button.setAttribute('aria-checked', String(!!running));
  button.disabled = starting || (!running && currentStep() === 'episode');
  renderModes();
}
function showError(message) { const text = message ? friendlyError(message) : ''; $('error').textContent = text; $('error').hidden = !text; }
function keyStatus(message) { $('key-status').textContent = message; }

function wordRow(word, count) {
  const row = document.createElement('div'); row.className = 'word';
  const head = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = word.romaji || '';
  const japanese = document.createElement('span'); japanese.className = 'reading'; japanese.textContent = word.japanese || '';
  head.append(strong, japanese); row.append(head);
  if (count) { const c = document.createElement('span'); c.className = 'count'; c.textContent = 'said ' + count + '×'; row.append(c); }
  if (word.meaning) { const def = document.createElement('div'); def.className = 'definition'; def.textContent = word.meaning; row.append(def); }
  return row;
}
const emptyNote = text => { const p = document.createElement('div'); p.className = 'empty'; p.textContent = text; return p; };

async function load() {
  const stored = await chrome.storage.local.get(['micReady', 'bank', 'spokenBank', 'progress', 'lastError', 'showJapanese', 'mode']);
  if (['rehearse', 'phrase', 'karaoke'].includes(stored.mode)) practiceMode = stored.mode;
  renderModes();
  micReady = !!stored.micReady;
  const bank = stored.bank || [];
  const spoken = [...(stored.spokenBank || [])].sort((a, b) => (b.count || 0) - (a.count || 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
  const progress = stored.progress || { phrases: 0 };
  $('mic').textContent = micReady ? 'Allowed' : 'Allow access'; $('mic').classList.toggle('enabled', micReady);
  $('japanese-toggle').setAttribute('aria-checked', String(!!stored.showJapanese));
  showError(stored.lastError || '');
  if (stored.lastError) chrome.storage.local.set({ lastError: '' }).catch(() => {});

  $('spoken').replaceChildren(...(spoken.length ? spoken.slice(0, 50).map(w => wordRow(w, w.count)) : [emptyNote('Nothing yet.')]));
  $('words').replaceChildren();
  if (!bank.length) $('words').append(emptyNote('Nothing yet.'));
  for (const word of bank) {
    const row = wordRow(word);
    if (word.context?.url?.startsWith('https://www.crunchyroll.com/')) { const a = document.createElement('a'); a.textContent = '↗'; a.title = 'Open the episode'; a.href = word.context.url; a.target = '_blank'; row.append(a); }
    $('words').append(row);
  }
  $('export').hidden = !bank.length && !spoken.length;
  $('progress').textContent = String(progress.phrases || 0);

  const status = await chrome.runtime.sendMessage({ target: 'worker', type: 'status' }); running = status?.session || null;
  const keyState = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-status' }); hasKey = !!keyState?.hasKey;
  keyStatus(hasKey ? 'Saved.' : 'Not saved.');
  [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  updateStart();
}

$('start').onclick = async () => {
  const step = currentStep();
  if (step === 'key') { showView('settings'); return; }
  if (step === 'mic') { await chrome.runtime.sendMessage({ target: 'worker', type: 'permission' }); return; }
  if (step === 'running') {
    const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'stop' });
    if (r?.error) showError(r.error); else { running = null; showError(''); }
    await load(); return;
  }
  if (step !== 'ready') return;
  showError(''); starting = true; updateStart();
  try {
    const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'start', tabId: currentTab.id, mode: practiceMode });
    if (r?.error) throw Error(r.error);
    window.close();
  } catch (e) { starting = false; showError(e.message); await load(); }
};
$('mic').onclick = () => chrome.runtime.sendMessage({ target: 'worker', type: 'permission' });
$('key-save').onclick = async () => {
  const value = $('meta-key').value; $('meta-key').value = '';
  if (!value.trim()) { keyStatus('Paste your key first.'); return; }
  const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-save', key: value });
  if (r?.error) { keyStatus(r.error); return; }
  hasKey = true; keyStatus('Saved.'); updateStart();
};
$('key-clear').onclick = async () => {
  $('meta-key').value = '';
  await chrome.runtime.sendMessage({ target: 'worker', type: 'key-clear' });
  hasKey = false; running = null; keyStatus('Removed.'); updateStart();
};
$('key-test').onclick = async () => {
  keyStatus('Checking…');
  const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-test' });
  keyStatus(r?.error ? friendlyError(r.error) : 'Works.');
};
$('japanese-toggle').onclick = async () => { const v = $('japanese-toggle').getAttribute('aria-checked') !== 'true'; await chrome.storage.local.set({ showJapanese: v }); $('japanese-toggle').setAttribute('aria-checked', String(v)); };
function renderModes() {
  for (const b of document.querySelectorAll('#modes button')) { b.setAttribute('aria-checked', String(b.dataset.mode === practiceMode)); b.disabled = starting; }
}
for (const b of document.querySelectorAll('#modes button')) b.onclick = async () => {
  practiceMode = b.dataset.mode; renderModes();
  await chrome.storage.local.set({ mode: practiceMode });
  if (running) { const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'set-mode', mode: practiceMode }); if (r?.error) showError(r.error); }
};
function showView(view) {
  for (const name of ['practice', 'words', 'settings']) $(name + '-view').hidden = name !== view;
  $('heading').textContent = { practice: 'Ttaku', words: 'Word bank', settings: 'Settings' }[view];
  $('back').hidden = view === 'practice'; $('tools').hidden = view !== 'practice';
  if (view !== 'practice') $('back').focus();
}
$('open-words').onclick = () => showView('words');
$('open-settings').onclick = () => showView('settings');
$('back').onclick = () => { showView('practice'); load(); };
$('export').onclick = async () => {
  const { bank = [], spokenBank = [] } = await chrome.storage.local.get(['bank', 'spokenBank']);
  const blob = new Blob([JSON.stringify({ saved: bank, spoken: spokenBank }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ttaku-word-bank.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
load();
