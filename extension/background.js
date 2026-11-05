// Privileged service worker: the only context that makes Meta HTTP requests.
// The API key lives in chrome.storage.local (extension-only storage; web
// pages cannot read it), is read here on demand, and is never sent to
// content scripts, pages, or logs. It persists across Chrome restarts and
// extension reloads until the user clears it in the popup.
import { META_BASE, TEXT_MODEL, ASR_MODEL, PHRASE_SCHEMA, READING_SCHEMA, PHRASE_INSTRUCTIONS, READING_INSTRUCTIONS, responsesBody, extractResponsesText, responseProblem, responseShape, parseEventStream, isSilentClip, sanitizeServerMessage, extractTranscript, transcribeRequest, validatePhraseOutput, validateReadingOutput, mapMetaError } from './meta-protocol.js';
import { base64ToBytes } from './audio-utils.js';

let starting = false;
const aborters = new Set();
let keyGeneration = 0;

try { chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS_ONLY' }); } catch {}

async function getKey() {
  const { metaKey } = await chrome.storage.local.get('metaKey');
  if (typeof metaKey === 'string' && metaKey) return metaKey;
  // Migrate a key saved in session storage by an earlier build, so it is
  // not lost one last time.
  const legacy = await chrome.storage.session.get('metaKey');
  if (typeof legacy.metaKey === 'string' && legacy.metaKey) {
    await chrome.storage.local.set({ metaKey: legacy.metaKey });
    await chrome.storage.session.remove('metaKey');
    return legacy.metaKey;
  }
  return null;
}
async function requireKey() {
  const key = await getKey();
  if (!key) throw Error('Enter your Meta Model API key in the Ttaku popup first.');
  return key;
}
function trackedSignal(ms = 55000) {
  const controller = new AbortController(); aborters.add(controller);
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener('abort', () => { clearTimeout(timer); aborters.delete(controller); }, { once: true });
  return controller.signal;
}
function endMetaSessions() {
  keyGeneration++;
  for (const c of aborters) c.abort(); aborters.clear();
  chrome.runtime.sendMessage({ target: 'audio', type: 'key-changed' }).catch(() => {});
}
async function metaFetch(path, init) {
  const key = await requireKey(); const generation = keyGeneration;
  let response;
  try {
    response = await fetch(META_BASE + path, { ...init, headers: { Authorization: 'Bearer ' + key, ...(init.headers || {}) }, signal: trackedSignal() });
  } catch (e) {
    if (generation !== keyGeneration) throw Error('The API key changed, so this request was stopped.');
    const message = e.name === 'AbortError' ? 'That took too long. Check your connection and try again.' : 'Could not reach Meta. Check your connection and try again.';
    chrome.storage.local.set({ lastError: message }).catch(() => {});
    throw Error(message);
  }
  let data = null;
  const raw = await response.text().catch(() => '');
  try { data = JSON.parse(raw); } catch { data = parseEventStream(raw); }
  if (!response.ok) {
    const serverMessage = sanitizeServerMessage(data?.error?.message || data?.message || '');
    const code = sanitizeServerMessage(data?.error?.code || data?.error?.type || '');
    chrome.storage.local.set({ metaDiag: (path + ' ' + response.status + ' ' + code).trim() }).catch(() => {});
    const message = serverMessage && ![401, 403].includes(response.status) ? serverMessage : mapMetaError(response.status);
    chrome.storage.local.set({ lastError: message }).catch(() => {}); throw Error(message);
  }
  chrome.storage.local.set({ lastError: '' }).catch(() => {});
  return data;
}
async function transcribeOnce(bytes, mode) {
  const form = new FormData();
  form.set('request', new Blob([JSON.stringify(transcribeRequest(mode))], { type: 'application/json' }));
  form.set('audio', new Blob([bytes], { type: 'audio/wav' }), 'clip.wav');
  const data = await metaFetch('/asr/transcribe', { method: 'POST', headers: { Accept: 'application/json' }, body: form });
  return extractTranscript(data);
}
async function transcribe(audioBase64) {
  if (typeof audioBase64 !== 'string' || audioBase64.length > 6000000) throw Error('That clip is too long. Try a shorter line.');
  const bytes = base64ToBytes(audioBase64);
  if (bytes.length < 48 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF') throw Error('A WAV audio clip is required.');
  if (isSilentClip(bytes)) return '';
  // NOTE: no expected answer is ever included in an ASR request.
  const text = await transcribeOnce(bytes, 'PUSH_TO_TALK');
  chrome.storage.local.set({ metaDiag: 'heard: ' + (text || '(nothing)').slice(0, 80) }).catch(() => {});
  return text;
}
async function structured(instructions, input, schema, name) {
  const data = await metaFetch('/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(responsesBody(instructions, input, schema, name)) });
  const text = extractResponsesText(data);
  if (text) { try { return JSON.parse(text); } catch {} }
  const problem = responseProblem(data);
  chrome.storage.local.set({ metaDiag: responseShape(data) }).catch(() => {});
  if (problem) throw Error(problem);
  throw Error(text ? 'Meta returned an unusable answer. Please retry.' : 'Meta finished but sent no answer. Please retry.');
}
const phraseCache = new Map();
async function phrase(audioBase64) {
  const text = await transcribe(audioBase64);
  if (!text || !/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) return { empty: true };
  if (phraseCache.has(text)) return phraseCache.get(text);
  const data = validatePhraseOutput(await structured(PHRASE_INSTRUCTIONS, { transcript: text }, PHRASE_SCHEMA, 'japanese_lines'));
  phraseCache.set(text, data); if (phraseCache.size > 300) phraseCache.delete(phraseCache.keys().next().value);
  return data;
}
async function phraseFromText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!clean || !/[\u3040-\u30ff\u3400-\u9fff]/.test(clean)) return { empty: true };
  if (phraseCache.has(clean)) return phraseCache.get(clean);
  const data = validatePhraseOutput(await structured(PHRASE_INSTRUCTIONS, { transcript: clean }, PHRASE_SCHEMA, 'japanese_lines'));
  phraseCache.set(clean, data); if (phraseCache.size > 300) phraseCache.delete(phraseCache.keys().next().value);
  return data;
}
async function attemptReading(audioBase64) {
  const heard = await transcribe(audioBase64);
  if (!heard) return { heard: '', reading: '' };
  // Only the recognized transcript is converted; the target stays local.
  const reading = validateReadingOutput(await structured(READING_INSTRUCTIONS, { transcript: heard }, READING_SCHEMA, 'heard_reading'));
  return { heard, reading: reading.reading };
}

const offscreen = async () => { if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'], justification: 'Listen to anime tab audio and the learner microphone for Japanese practice.' }); };
async function control(message) { return chrome.runtime.sendMessage({ target: 'audio', ...message }); }
async function session() { return (await chrome.storage.session.get('session')).session; }
async function stop() {
  const current = await session();
  endMetaSessions();
  await control({ type: 'stop' }).catch(() => {});
  if (current) await chrome.tabs.sendMessage(current.tabId, { target: 'player', type: 'stop' }).catch(() => {});
  await chrome.storage.session.remove('session'); await chrome.action.setBadgeText({ text: '' });
}
function isSupportedPage(url = '') {
  return url.startsWith('https://www.crunchyroll.com/watch/') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
}
async function start(tab, mode = 'rehearse') {
  if (starting) throw Error('Ttaku is still starting. Give it a moment.');
  if (await session()) throw Error('Ttaku is already running. Stop practice before starting another episode.');
  starting = true;
  try {
    if (!isSupportedPage(tab.url)) throw Error('Open a Crunchyroll episode (or the local test page) first.');
    if (!await getKey()) throw Error('Enter your Meta Model API key in the Ttaku popup first.');
    const settings = await chrome.storage.local.get('micReady');
    if (!settings.micReady) throw Error('Allow microphone access before starting practice.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
    const ready = await chrome.tabs.sendMessage(tab.id, { target: 'player', type: 'probe' });
    if (!ready?.video) throw Error('No video found yet. Start the episode once, then click Ttaku.');
    await offscreen();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ session: { tabId: tab.id, id, frameId: ready.frameId || 0, title: tab.title, url: tab.url } });
    const r = await control({ type: 'start', streamId, sessionId: id, mode });
    if (r?.error) throw Error(r.error);
    await chrome.tabs.sendMessage(tab.id, { target: 'player', type: 'start', sessionId: id, mode });
    await chrome.action.setBadgeBackgroundColor({ color: '#dd583b' }); await chrome.action.setBadgeText({ text: 'ON' });
  } catch (error) { await stop(); await chrome.storage.local.set({ lastError: error.message }); throw error; } finally { starting = false; }
}

async function switchMode(newMode) {
  if (!['rehearse', 'phrase', 'karaoke'].includes(newMode)) return;
  await chrome.storage.local.set({ mode: newMode });
  const current = await session(); if (!current) return { ok: true };
  // Pause the video while Ttaku readjusts, then play again when ready.
  await chrome.tabs.sendMessage(current.tabId, { target: 'player', type: 'mode-pause' }).catch(() => {});
  await control({ type: 'set-mode', mode: newMode, sessionId: current.id }).catch(() => {});
  await chrome.tabs.sendMessage(current.tabId, { target: 'player', type: 'set-mode', mode: newMode }).catch(() => {});
  return { ok: true };
}
chrome.tabs.onRemoved.addListener(async id => { if ((await session())?.tabId === id) await stop(); });
chrome.commands.onCommand.addListener(async command => { if (command === 'capture-phrase') await control({ type: 'commit' }).catch(() => {}); });

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const run = async () => {
    if (m.target === 'meta') {
      if (m.type === 'phrase') return phrase(m.audioBase64);
      if (m.type === 'attempt-reading') return attemptReading(m.audioBase64);
      if (m.type === 'phrase-text') return phraseFromText(m.text);
      if (m.type === 'transcribe') return { text: await transcribe(m.audioBase64) };
      return;
    }
    if (m.target !== 'worker') return;
    if (m.type === 'status') return { session: await session() };
    if (m.type === 'key-status') return { hasKey: !!await getKey() };
    if (m.type === 'key-save') {
      const key = String(m.key || '').trim();
      if (!key) throw Error('Paste a Meta Model API key first.');
      endMetaSessions();
      await chrome.storage.local.set({ metaKey: key }); await chrome.storage.session.remove('metaKey');
      return { ok: true, hasKey: true };
    }
    if (m.type === 'key-clear') { endMetaSessions(); await chrome.storage.local.remove('metaKey'); await chrome.storage.session.remove('metaKey'); return { ok: true, hasKey: false }; }
    if (m.type === 'set-mode') return switchMode(m.mode);
    if (m.type === 'key-get') return { key: await getKey() };
    if (m.type === 'diag') {
      if (m.diag) await chrome.storage.local.set({ diag: { peak: Number(m.diag.peak) || 0, rms: Number(m.diag.rms) || 0, started: !!m.diag.started, armed: !!m.diag.armed, clips: Number(m.diag.clips) || 0, outcome: String(m.diag.outcome || '').slice(0, 200), at: Number(m.diag.at) || Date.now() } });
      return { ok: true };
    }
    if (m.type === 'key-test') {
      await structured('Return the hiragana reading of the supplied Japanese word, as data.', { transcript: 'ありがとう' }, READING_SCHEMA, 'connection_test');
      return { ok: true, models: [ASR_MODEL, TEXT_MODEL] };
    }
    if (m.type === 'start') { const tab = await chrome.tabs.get(m.tabId); await start(tab, ['rehearse', 'phrase', 'karaoke'].includes(m.mode) ? m.mode : 'rehearse'); await chrome.storage.local.set({ lastError: '' }); return { ok: true }; }
    if (m.type === 'permission') { await chrome.windows.create({ url: chrome.runtime.getURL('microphone.html'), type: 'popup', width: 390, height: 330 }); return { ok: true }; }
    if (m.type === 'stop') { await stop(); return { ok: true }; }
    if (m.type === 'save') {
      const { bank = [] } = await chrome.storage.local.get('bank'); const key = m.word.japanese;
      const old = bank.find(x => x.japanese === key); if (old) { old.encounters++; old.lastSeen = Date.now(); } else bank.unshift({ ...m.word, encounters: 1, lastSeen: Date.now(), context: m.context });
      await chrome.storage.local.set({ bank }); return { ok: true };
    }
    if (m.type === 'passed') {
      const { progress = { phrases: 0, attempts: 0 }, spokenBank = [] } = await chrome.storage.local.get(['progress', 'spokenBank']);
      progress.phrases++;
      // Build the user's spoken word bank: words from each finished line.
      const seen = new Set();
      for (const w of Array.isArray(m.words) ? m.words.slice(0, 12) : []) {
        if (!w || typeof w.romaji !== 'string' || !w.romaji) continue;
        const japanese = typeof w.japanese === 'string' ? w.japanese : '';
        const dedupe = japanese + '|' + w.romaji; if (seen.has(dedupe)) continue; seen.add(dedupe);
        const old = spokenBank.find(x => x.japanese === japanese && x.romaji === w.romaji);
        if (old) { old.count = (old.count || 1) + 1; old.lastSeen = Date.now(); if (!old.meaning && typeof w.meaning === 'string') old.meaning = w.meaning; }
        else spokenBank.push({ japanese, reading: typeof w.reading === 'string' ? w.reading : '', romaji: w.romaji, meaning: typeof w.meaning === 'string' ? w.meaning : '', count: 1, lastSeen: Date.now() });
      }
      await chrome.storage.local.set({ progress, spokenBank: spokenBank.slice(0, 500) }); return;
    }
    const current = await session(); if (!current) return;
    if (m.type === 'audio-event') { if (m.sessionId !== current.id) return; return chrome.tabs.sendMessage(current.tabId, { target: 'player', ...m.event }).catch(() => {}); }
    if (m.type === 'player-event' && sender.tab?.id === current.tabId) {
      if (m.event?.type === 'set-mode') return switchMode(m.event.mode);
      return control({ ...m.event, sessionId: current.id });
    }
  };
  if (!['worker', 'meta'].includes(m.target)) return;
  run().then(reply, e => reply({ error: e.message })); return true;
});
