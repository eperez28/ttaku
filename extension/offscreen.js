// Offscreen document: tab + microphone capture, segmentation, and the live
// Meta realtime stream. HTTP Meta calls are delegated to the service worker;
// the expected line never leaves this document for ASR or reading conversion.
import { Segmenter, wav24Base64, pcm24Bytes } from './audio-utils.js';
import { recognizedPrefix, recognizedMatches, compactLines, isPauseWorthy } from './word-progress.js';
import { matchReading } from './matching.js';
import { META_WS, buildHandshake, isHandshakeAck, cumulativeTranscript } from './meta-protocol.js';

let context, tabStream, micStream, sessionId, phase = 'off', phrase = null, lines = [], lineIndex = 0, tabSegments, micSegments, epoch = 0, armedAt = 0;
let live = null, liveReady = false, liveQueue = [], liveFailed = false, liveEndTimer = null;
let apiKeyCache = null;
let sourceLive = null, sourceReady = false, sourceQueue = [], sourceText = '', sourceWaiter = null, sourceFailed = false;
const emit = event => chrome.runtime.sendMessage({ target: 'worker', type: 'audio-event', sessionId, event }).catch(() => {});
let diag = { peak: 0, rms: 0, started: false, armed: false, clips: 0, outcome: 'waiting to hear the video', at: Date.now() };
let recentPeak = 0;
let diagSavedAt = 0;
function saveDiag(outcome) {
  if (outcome) diag.outcome = outcome;
  diag.peak = recentPeak; recentPeak = 0;
  if (tabSegments) { diag.rms = tabSegments.lastRms || 0; diag.started = !!tabSegments.started; }
  diag.armed = performance.now() > armedAt;
  diag.at = Date.now();
  if (diag.at - diagSavedAt < 800) return;
  diagSavedAt = diag.at;
  // Offscreen documents have no chrome.storage API: the service worker writes it.
  chrome.runtime.sendMessage({ target: 'worker', type: 'diag', diag: { ...diag } }).catch(() => {});
}
async function getApiKey() {
  if (apiKeyCache) return apiKeyCache;
  try { const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-get' }); apiKeyCache = r?.key || null; } catch {}
  return apiKeyCache;
}
function finishSource(text) {
  const waiter = sourceWaiter; sourceWaiter = null;
  const ws = sourceLive; sourceLive = null; sourceReady = false; sourceQueue = [];
  if (ws) { try { ws.close(); } catch {} }
  if (waiter) waiter(text || sourceText || '');
}
function openSourceLive() {
  if (sourceLive || sourceFailed) return;
  sourceText = ''; sourceQueue = [];
  if (!apiKeyCache) { sourceFailed = true; return; }
  let ws;
  try { ws = new WebSocket(META_WS); } catch { sourceFailed = true; return; }
  sourceLive = ws; ws.binaryType = 'arraybuffer';
  ws.onopen = () => { try { ws.send(JSON.stringify(buildHandshake(apiKeyCache))); } catch {} };
  ws.onmessage = e => {
    if (ws !== sourceLive || typeof e.data !== 'string') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (isHandshakeAck(m)) { sourceReady = true; for (const f of sourceQueue) { try { ws.send(f); } catch {} } sourceQueue = []; return; }
    if (m.type === 'error') { sourceFailed = true; finishSource(''); return; }
    const partial = cumulativeTranscript(m);
    if (partial) { sourceText = partial.text; if (partial.final) finishSource(sourceText); }
  };
  ws.onerror = () => { sourceFailed = true; };
  ws.onclose = () => { if (ws === sourceLive) finishSource(sourceText); };
}
function streamTab(chunk) {
  if (!sourceLive || sourceFailed) return;
  const bytes = pcm24Bytes(chunk, context.sampleRate);
  const frame = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (sourceReady && sourceLive?.readyState === WebSocket.OPEN) { try { sourceLive.send(frame); } catch { sourceFailed = true; } }
  else if (sourceQueue.length < 240) sourceQueue.push(frame);
}
function finalizeSourceLive() {
  if (!sourceLive) return Promise.resolve('');
  try { if (sourceLive.readyState === WebSocket.OPEN) sourceLive.send(JSON.stringify({ type: 'endStream' })); } catch {}
  return new Promise(resolve => {
    sourceWaiter = resolve;
    setTimeout(() => { if (sourceWaiter === resolve) finishSource(sourceText); }, 2800);
  });
}
function closeSourceLive() { sourceLive = null; sourceReady = false; sourceQueue = []; sourceWaiter = null; }
const meta = message => chrome.runtime.sendMessage({ target: 'meta', ...message });

async function node(stream, callback) {
  const source = context.createMediaStreamSource(stream), worklet = new AudioWorkletNode(context, 'taku-pcm'), silent = context.createGain(); silent.gain.value = 0; source.connect(worklet); worklet.connect(silent); silent.connect(context.destination); worklet.port.onmessage = e => callback(e.data); return source;
}
function closeLive(finalize = false) {
  clearTimeout(liveEndTimer);
  const ws = live; live = null; liveReady = false; liveQueue = [];
  if (!ws) return;
  try {
    if (finalize && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: 'endStream' })); liveEndTimer = setTimeout(() => { try { ws.close(); } catch {} }, 350); }
    else ws.close();
  } catch {}
}
async function openLive() {
  closeLive(); liveFailed = false;
  const metaKey = await getApiKey();
  if (!metaKey) { liveFailed = true; return; } // Completed-audio check still works.
  let ws;
  try { ws = new WebSocket(META_WS); } catch { liveFailed = true; return; }
  live = ws; ws.binaryType = 'arraybuffer';
  ws.onopen = () => { try { ws.send(JSON.stringify(buildHandshake(metaKey))); } catch {} };
  ws.onmessage = e => {
    if (ws !== live || typeof e.data !== 'string') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (isHandshakeAck(m)) { liveReady = true; for (const frame of liveQueue) { try { ws.send(frame); } catch {} } liveQueue = []; return; }
    if (m.type === 'error') { liveFailed = true; closeLive(); return; }
    const partial = cumulativeTranscript(m);
    // Each cumulative partial replaces the last one; fill every word it
    // matches, even if an earlier word was misheard.
    if (partial && phrase && ['listening', 'checking'].includes(phase)) {
      const { mask, partial: part } = recognizedMatches(phrase.tokens || [], partial.text);
      emit({ type: 'word-progress', count: mask.filter(Boolean).length, mask, part });
      if (phase === 'listening' && mask.length && mask.every(Boolean)) acceptLive();
    }
  };
  ws.onerror = () => { liveFailed = true; };
  ws.onclose = () => { if (ws === live) { live = null; liveReady = false; liveQueue = []; } };
}
function streamMic(chunk) {
  if (liveFailed) return;
  if (!live) { openLive(); }
  const bytes = pcm24Bytes(chunk, context.sampleRate);
  const frame = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (liveReady && live?.readyState === WebSocket.OPEN) { try { live.send(frame); } catch { liveFailed = true; } }
  else if (liveQueue.length < 200) liveQueue.push(frame);
}
async function acceptLive() {
  if (phase !== 'listening' || !phrase) return;
  const ticket = ++epoch; phase = 'passed'; closeLive(); micSegments?.reset();
  saveDiag('repeat accepted (live), playing again');
  emit({ type: 'result', passed: true, heard: '', similarity: 100 });
  emit({ type: 'word-progress', count: phrase.tokens?.length || 100 });
  await chrome.runtime.sendMessage({ target: 'worker', type: 'passed', words: (phrase.words?.length ? phrase.words : (phrase.tokens || []).map(tok => ({ japanese: tok.japanese || '', reading: tok.reading || '', romaji: tok.romaji || '', meaning: '' }))) }).catch(() => {});
  setTimeout(() => { if (ticket === epoch) advance(); }, 500);
}
function listen(phaseName = 'listening') { phase = 'listening'; micSegments.reset(); armedAt = performance.now() + 450; saveDiag('paused, waiting for you to repeat it'); emit({ type: 'word-progress', count: 0 }); emit({ type: 'state', phase: phaseName, message: '' }); openLive(); }
function showLine() {
  phrase = lines[lineIndex]; emit({ type: 'phrase', phrase, lineIndex, lineCount: lines.length }); listen();
  const shown = phrase;
  meta({ type: 'phrase-enrich', japanese: shown.japanese, romaji: shown.romaji }).then(r => {
    if (r && !r.error && phrase === shown) { shown.meaning = r.meaning || ''; shown.words = r.words || []; emit({ type: 'phrase-details', meaning: shown.meaning, words: shown.words }); }
  }).catch(() => {});
}
function advance() { closeLive(); if (lineIndex + 1 < lines.length) { epoch++; lineIndex++; showLine(); } else resume(); }
async function analyze(segment, prePaused = false, liveTextPromise = null) {
  const ticket = ++epoch; phase = 'processing'; const startedAt = performance.now();
  // Fast path: one ASR call decides the pause. The romaji is built *while*
  // the video is already paused, instead of making the pause wait for it.
  try {
    let text = '';
    if (liveTextPromise) { try { text = (await liveTextPromise || '').trim(); } catch {} }
    // A live transcript that is far shorter than the clip is a tail fragment
    // (the socket joined mid-line): trust the full recording instead.
    const liveChars = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
    if (liveChars < Math.min(12, segment.duration * 2)) text = '';
    if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) {
      const heard = await meta({ type: 'transcribe', audioBase64: wav24Base64(segment.chunks, context.sampleRate) });
      if (heard?.error) throw Error(heard.error);
      text = (heard?.text || '').trim();
    }
    if (ticket !== epoch) return;
    if (!isPauseWorthy(text, segment.duration)) {
      // Not a line worth stopping for: a grunt, a laugh, or a fragment.
      phase = 'watching'; tabSegments.reset(); armedAt = performance.now() + 180; saveDiag('not a pause-worthy line, letting it play');
      if (prePaused) emit({ type: 'resume' }); else emit({ type: 'state', phase: 'empty', message: '' });
      return;
    }
    saveDiag('Japanese line confirmed, pausing');
    if (!prePaused) emit({ type: 'pause', duration: segment.duration, delaySeconds: (performance.now() - startedAt) / 1000 });
    emit({ type: 'state', phase: 'processing', message: 'Getting this line…' });
    const built = await meta({ type: 'phrase-display', text });
    if (built?.error) throw Error(built.error);
    if (ticket !== epoch) return;
    lines = built.empty ? [] : compactLines(built.lines?.length ? built.lines : [built]).filter(l => l.romaji && l.reading && /[\u3040-\u30ff\u3400-\u9fff]/.test(l.japanese || ''));
    if (!lines.length) { phase = 'error'; saveDiag('could not build a line from that'); emit({ type: 'state', phase: 'error', message: 'I couldn’t make out that line.' }); return; }
    lineIndex = 0; showLine();
    // Precise token alignment arrives just behind the display and swaps in
    // without disturbing words already filled.
    const shown = lines[0];
    meta({ type: 'phrase-text', text }).then(r => {
      if (!r || r.error || r.empty || phrase !== shown) return;
      const full = (r.lines?.length ? r.lines : [r]).map(l => ({ ...l }));
      const match = full.find(l => l.japanese === shown.japanese) || full[0];
      if (match?.tokens?.length) { shown.tokens = match.tokens; emit({ type: 'phrase-tokens', tokens: match.tokens }); }
    }).catch(() => {});
  } catch (error) { if (ticket === epoch) { phase = 'watching'; tabSegments.reset(); armedAt = performance.now() + 180; saveDiag('Meta error: ' + error.message); emit({ type: 'state', phase: 'error', message: error.message }); } }
}
async function check(segment) {
  const ticket = ++epoch; phase = 'checking'; closeLive(true); saveDiag('heard you, checking…'); emit({ type: 'state', phase, message: '' });
  try {
    const heardResult = await meta({ type: 'attempt-reading', audioBase64: wav24Base64(segment.chunks, context.sampleRate) });
    if (heardResult?.error) throw Error(heardResult.error);
    if (ticket !== epoch) return;
    const result = { heard: heardResult.heard || '', ...matchReading(phrase.reading, heardResult.reading || '') };
    saveDiag(result.passed ? 'repeat accepted, playing again' : 'repeat not accepted (match ' + result.similarity + '%)');
    emit({ type: 'result', ...result });
    if (result.passed) { phase = 'passed'; emit({ type: 'word-progress', count: phrase.tokens?.length || 100 }); await chrome.runtime.sendMessage({ target: 'worker', type: 'passed', words: (phrase.words?.length ? phrase.words : (phrase.tokens || []).map(tok => ({ japanese: tok.japanese || '', reading: tok.reading || '', romaji: tok.romaji || '', meaning: '' }))) }); setTimeout(() => { if (ticket === epoch) advance(); }, 650); }
    else { phase = 'retry'; emit({ type: 'state', phase, message: result.heard ? 'Try that line again.' : 'I couldn’t hear you.' }); setTimeout(() => { if (ticket === epoch) listen('retry'); }, 1300); }
  } catch (error) { if (ticket === epoch) { phase = 'error'; saveDiag('repeat check failed: ' + error.message); emit({ type: 'state', phase, message: error.message }); } }
}
function resume() { epoch++; closeLive(); closeSourceLive(); phase = 'watching'; phrase = null; lines = []; lineIndex = 0; tabSegments.reset(); micSegments.reset(); armedAt = performance.now() + 180; emit({ type: 'resume' }); emit({ type: 'state', phase, message: '' }); }
async function stop() { epoch++; closeLive(); closeSourceLive(); apiKeyCache = null; phase = 'off'; for (const stream of [tabStream, micStream]) stream?.getTracks().forEach(t => t.stop()); tabStream = micStream = null; if (context) { await context.close(); context = null; } }
async function start(m) {
  await stop(); sessionId = m.sessionId; apiKeyCache = null; sourceFailed = false; getApiKey(); diag = { peak: 0, rms: 0, started: false, armed: false, clips: 0, outcome: 'waiting to hear the video', at: Date.now() }; recentPeak = 0; saveDiag();
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId } }, video: false });
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    context = new AudioContext(); await context.resume(); await context.audioWorklet.addModule('pcm-worklet.js');
    tabSegments = new Segmenter(context.sampleRate, { maxSeconds: 6, silenceSeconds: .3, threshold: .005, peakThreshold: .04 }); micSegments = new Segmenter(context.sampleRate, { maxSeconds: 20, silenceSeconds: .6, threshold: .018 });
    const tabSource = await node(tabStream, chunk => {
      for (let i = 0; i < chunk.length; i += 8) { const v = Math.abs(chunk[i]); if (v > recentPeak) recentPeak = v; }
      saveDiag();
      if (phase === 'watching' && performance.now() > armedAt) {
        const wasStarted = tabSegments.started;
        const segment = tabSegments.push(chunk);
        if (!wasStarted && tabSegments.started) { openSourceLive(); for (const pre of tabSegments.chunks.slice(0, -1)) streamTab(pre); }
        if (tabSegments.started || segment) streamTab(chunk);
        if (segment) {
          diag.clips++; saveDiag('heard a clip, sending it to Meta…');
          const liveText = finalizeSourceLive();
          emit({ type: 'pause', duration: segment.duration, delaySeconds: .35 }); emit({ type: 'state', phase: 'processing', message: 'Getting this line…' }); analyze(segment, true, liveText);
        }
      }
    }); tabSource.connect(context.destination);
    await node(micStream, chunk => {
      if (phase !== 'listening' || performance.now() < armedAt) return;
      streamMic(chunk);
      const segment = micSegments.push(chunk);
      if (segment) check(segment);
    });
    tabStream.getAudioTracks().forEach(t => t.onended = () => { stop(); emit({ type: 'state', phase: 'error', message: 'Tab sharing ended. Restart Ttaku to reconnect.' }); });
    phase = 'watching'; armedAt = performance.now() + 200; return { ok: true };
  } catch (error) { await stop(); throw error; }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.target !== 'audio' || sender.id !== chrome.runtime.id) return;
  const run = async () => {
    if (m.type === 'key-changed') { closeLive(); liveFailed = true; return { ok: true }; }
    if (m.type === 'start') return start(m);
    if (m.type === 'stop') { await stop(); return { ok: true }; }
    if (m.sessionId && m.sessionId !== sessionId) return;
    if (m.type === 'user-continue') { epoch++; closeLive(); resume(); return { ok: true }; }
    if (m.type === 'skip') { epoch++; if (phrase) advance(); else resume(); return { ok: true }; }
    if (m.type === 'retry' && phrase) { epoch++; listen('listening'); return { ok: true }; }
    if (m.type === 'replay' && phrase) { epoch++; closeLive(); phase = 'replay'; emit({ type: 'replay' }); return { ok: true }; }
    if (m.type === 'replay-ended') { listen(); return { ok: true }; }
    if (m.type === 'commit' || m.type === 'caption-boundary') {
      if (phase === 'watching') { const s = tabSegments.finish(); if (s) { diag.clips++; if (m.type === 'caption-boundary') { emit({ type: 'pause', duration: s.duration, delaySeconds: 0 }); emit({ type: 'state', phase: 'processing', message: 'Getting this line…' }); } analyze(s, m.type === 'caption-boundary'); } } else if (phase === 'listening' && m.type === 'commit') { const s = micSegments.finish(); if (s) check(s); } return { ok: true };
    }
    if (m.type === 'video-paused' && phase === 'watching') { tabSegments.reset(); armedAt = Infinity; }
    if (m.type === 'video-playing' && phase === 'watching') { tabSegments.reset(); armedAt = performance.now() + 120; }
    return { ok: true };
  };
  run().then(reply, e => reply({ error: e.message })); return true;
});
