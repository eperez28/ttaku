const $ = id => document.getElementById(id);
let running = null, currentTab = null, micReady = false, hasKey = false;
function keyStatus(message) { $('key-status').textContent = message; }
function updateStart() {
  const button = $('start');
  const isEpisode = currentTab?.url?.startsWith('https://www.crunchyroll.com/watch/') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(currentTab?.url || '');
  button.classList.toggle('stop', !!running);
  button.disabled = !running && hasKey && micReady && !isEpisode;
  button.textContent = running ? 'Stop practice' : !hasKey ? 'Save API key first' : !micReady ? 'Allow microphone' : 'Start practice';
}
function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
async function load() {
  const stored = await chrome.storage.local.get(['micReady', 'bank', 'progress', 'lastError', 'showJapanese', 'diag']);
  micReady = !!stored.micReady; const bank = stored.bank || [], progress = stored.progress || { phrases: 0 };
  $('mic').textContent = micReady ? 'Allowed' : 'Allow access'; $('mic').classList.toggle('enabled', micReady); $('japanese-toggle').setAttribute('aria-checked', String(!!stored.showJapanese));
  error(stored.lastError); $('words').replaceChildren();
  if (!bank.length) { const p = document.createElement('div'); p.className = 'empty'; p.textContent = 'Words you save during practice will appear here.'; $('words').append(p); }
  for (const word of bank) {
    const row = document.createElement('div'); row.className = 'word'; const head = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = word.romaji; const reading = document.createElement('span'); reading.className = 'reading'; reading.textContent = word.japanese; head.append(strong, reading);
    const definition = document.createElement('div'); definition.className = 'definition'; definition.textContent = word.meaning; const context = document.createElement('small'); context.textContent = word.context?.romaji || ''; definition.append(context); const a = document.createElement('a'); a.textContent = '↗'; a.title = 'Open the episode'; if (word.context?.url?.startsWith('https://www.crunchyroll.com/')) a.href = word.context.url; a.target = '_blank'; row.append(head, definition, a); $('words').append(row);
  }
  $('export').hidden = !bank.length; $('progress').textContent = progress.phrases + ' ' + (progress.phrases === 1 ? 'line' : 'lines') + ' practiced';
  const current = await chrome.runtime.sendMessage({ target: 'worker', type: 'status' }); running = current?.session;
  const keyState = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-status' }); hasKey = !!keyState?.hasKey;
  keyStatus(hasKey ? 'Key saved on this device. It stays saved after Chrome restarts — Clear removes it.' : 'No key saved yet. It is stored only in the extension, never on web pages.');
  [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const isPlayer = currentTab?.url?.startsWith('https://www.crunchyroll.com/watch/') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(currentTab?.url || '');
  $('episode-title').textContent = isPlayer ? (currentTab.title || 'Video episode').replace(/ - Watch on Crunchyroll$/, '') : 'Open a Crunchyroll episode';
  if (stored.diag) {
    const ago = Math.max(0, Math.round((Date.now() - (stored.diag.at || 0)) / 1000));
    $('helper').hidden = false;
    $('helper').textContent = 'Sound check — loudest heard: ' + (stored.diag.peak || 0).toFixed(2) + ' · clips sent: ' + (stored.diag.clips || 0) + ' · last: ' + (stored.diag.outcome || '') + ' (' + ago + 's ago)';
  } else $('helper').hidden = true;
  $('usage').textContent = '';
  updateStart();
}
$('key-save').onclick = async () => {
  const value = $('meta-key').value; $('meta-key').value = '';
  const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-save', key: value });
  if (r?.error) { keyStatus(r.error); return; }
  hasKey = true; keyStatus('Key saved on this device. It stays saved after Chrome restarts — Clear removes it.'); updateStart();
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
$('mic').onclick=()=>chrome.runtime.sendMessage({target:'worker',type:'permission'});
$('start').onclick=async()=>{
  if (!running && !hasKey) { keyStatus('Save your Meta Model API key first.'); return; }
  if (!running && !micReady) {
    await chrome.runtime.sendMessage({target:'worker',type:'permission'});
    return;
  }
  $('start').disabled=true;
  try{const wasRunning=!!running;const result=await chrome.runtime.sendMessage(running?{target:'worker',type:'stop'}:{target:'worker',type:'start',tabId:currentTab.id});if(result?.error)throw Error(result.error);await load();if(!wasRunning&&running)window.close()}catch(e){error(e.message);updateStart()}
};
$('japanese-toggle').onclick=async()=>{const showJapanese=$('japanese-toggle').getAttribute('aria-checked')!=='true';await chrome.storage.local.set({showJapanese});$('japanese-toggle').setAttribute('aria-checked',String(showJapanese))};
function showView(view) {
  for (const name of ['practice', 'words', 'settings']) $(name + '-view').hidden = name !== view;
  $('heading').textContent = {practice: 'Taku', words: 'Saved words', settings: 'Settings'}[view];
  $('back').hidden = view === 'practice';
  $('tools').hidden = view !== 'practice';
  if (view !== 'practice') $('back').focus();
}
$('open-words').onclick = () => showView('words');
$('open-settings').onclick = () => showView('settings');
$('back').onclick = () => showView('practice');
$('export').onclick=async()=>{const {bank=[]}=await chrome.storage.local.get('bank');const blob=new Blob([JSON.stringify(bank,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='taku-words.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
load();
