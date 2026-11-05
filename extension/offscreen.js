// Offscreen document: tab + microphone capture, segmentation, and the live
// Meta realtime stream. HTTP Meta calls are delegated to the service worker;
// the expected line never leaves this document for ASR or reading conversion.
import { Segmenter, wav24Base64, pcm24Bytes } from './audio-utils.js';
import { recognizedPrefix, compactLines } from './word-progress.js';
import { matchReading } from './matching.js';
import { META_WS, buildHandshake, isHandshakeAck, cumulativeTranscript } from './meta-protocol.js';

let context, tabStream, micStream, sessionId, mode = 'rehearse', oneShot = false, phase = 'off', phrase = null, lines = [], lineIndex = 0, tabSegments, micSegments, epoch = 0, armedAt = 0;
let live = null, liveReady = false, liveQueue = [], liveFailed = false, liveEndTimer = null;
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
  try { const r = await chrome.runtime.sendMessage({ target: 'worker', type: 'key-get' }); return r?.key || null; } catch { return null; }
}
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
    // Each cumulative partial replaces the last one; feed it straight to matching.
    if (partial && phrase && ['listening', 'checking', 'karaoke'].includes(phase)) emit({ type: 'word-progress', count: recognizedPrefix(phrase.tokens || [], partial.text) });
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
function listen(phaseName = 'listening') { phase = 'listening'; micSegments.reset(); armedAt = performance.now() + 450; emit({ type: 'word-progress', count: 0 }); emit({ type: 'state', phase: phaseName, message: '' }); openLive(); }
function showLine() { phrase = lines[lineIndex]; emit({ type: 'phrase', phrase, lineIndex, lineCount: lines.length }); listen(); }
function advance() { closeLive(); if (lineIndex + 1 < lines.length) { epoch++; lineIndex++; showLine(); } else resume(); }
async function analyze(segment) {
  const ticket = ++epoch; phase = 'processing'; const startedAt = performance.now();
  // Do NOT pause yet: any tab audio (music, effects, other languages) makes a
  // segment. The video only pauses below, after Meta transcribes the clip and
  // the phrase pipeline confirms it is a usable Japanese line.
  try {
    const result = await meta({ type: 'phrase', audioBase64: wav24Base64(segment.chunks, context.sampleRate) });
    if (result?.error) throw Error(result.error);
    if (ticket !== epoch) return;
    lines = result.empty ? [] : compactLines(result.lines?.length ? result.lines : [result]).filter(l => l.romaji && l.reading && /[\u3040-\u30ff\u3400-\u9fff]/.test(l.japanese || ''));
    if (!lines.length) { phase = 'watching'; tabSegments.reset(); armedAt = performance.now() + 180; saveDiag('Meta heard no Japanese line in that clip'); emit({ type: 'state', phase: 'empty', message: '' }); return; }
    saveDiag('Japanese line confirmed, pausing'); lineIndex = 0; emit({ type: 'pause', duration: segment.duration, delaySeconds: (performance.now() - startedAt) / 1000 }); emit({ type: 'state', phase: 'processing', message: 'Getting this line…' }); showLine();
  } catch (error) { if (ticket === epoch) { phase = 'watching'; tabSegments.reset(); armedAt = performance.now() + 180; saveDiag('Meta error: ' + error.message); emit({ type: 'state', phase: 'error', message: error.message }); } }
}
async function analyzeKaraoke(segment) {
  if (phase === 'processing') return;
  const ticket = ++epoch; phase = 'processing';
  try {
    const result = await meta({ type: 'phrase', audioBase64: wav24Base64(segment.chunks, context.sampleRate) });
    if (result?.error) throw Error(result.error);
    if (ticket !== epoch || mode !== 'karaoke') return;
    const found = result.empty ? [] : compactLines(result.lines?.length ? result.lines : [result]).filter(l => l.romaji && l.reading);
    phase = 'karaoke';
    if (found.length) { phrase = found[0]; emit({ type: 'karaoke-phrase', phrase }); openLive(); }
  } catch { if (ticket === epoch) phase = 'karaoke'; }
}
async function karaokeCaption(text) {
  try {
    const result = await meta({ type: 'phrase-text', text });
    if (result?.error || result?.empty || mode !== 'karaoke') return;
    const found = compactLines(result.lines?.length ? result.lines : [result]).filter(l => l.romaji && l.reading);
    if (found.length) { phrase = found[0]; phase = 'karaoke'; emit({ type: 'karaoke-phrase', phrase }); openLive(); }
  } catch {}
}
async function check(segment) {
  const ticket = ++epoch; phase = 'checking'; closeLive(true); emit({ type: 'state', phase, message: '' });
  try {
    const heardResult = await meta({ type: 'attempt-reading', audioBase64: wav24Base64(segment.chunks, context.sampleRate) });
    if (heardResult?.error) throw Error(heardResult.error);
    if (ticket !== epoch) return;
    const result = { heard: heardResult.heard || '', ...matchReading(phrase.reading, heardResult.reading || '') };
    emit({ type: 'result', ...result });
    if (result.passed) { phase = 'passed'; emit({ type: 'word-progress', count: phrase.tokens?.length || 100 }); await chrome.runtime.sendMessage({ target: 'worker', type: 'passed', words: (phrase.words?.length ? phrase.words : (phrase.tokens || []).map(tok => ({ japanese: tok.japanese || '', reading: tok.reading || '', romaji: tok.romaji || '', meaning: '' }))) }); setTimeout(() => { if (ticket === epoch) advance(); }, 650); }
    else { phase = 'retry'; emit({ type: 'state', phase, message: result.heard ? 'Try that line again.' : 'I couldn’t hear you.' }); setTimeout(() => { if (ticket === epoch) listen('retry'); }, 1300); }
  } catch (error) { if (ticket === epoch) { phase = 'error'; emit({ type: 'state', phase, message: error.message }); } }
}
function resume() { epoch++; closeLive(); phase = 'watching'; phrase = null; lines = []; lineIndex = 0; tabSegments.reset(); micSegments.reset(); armedAt = performance.now() + 180; emit({ type: 'resume' }); emit({ type: 'state', phase, message: '' }); }
async function stop() { epoch++; closeLive(); phase = 'off'; for (const stream of [tabStream, micStream]) stream?.getTracks().forEach(t => t.stop()); tabStream = micStream = null; if (context) { await context.close(); context = null; } }
async function start(m) {
  await stop(); sessionId = m.sessionId; mode = ['rehearse', 'phrase', 'karaoke'].includes(m.mode) ? m.mode : 'rehearse'; oneShot = false; diag = { peak: 0, rms: 0, started: false, armed: false, clips: 0, outcome: 'waiting to hear the video', at: Date.now() }; recentPeak = 0; saveDiag();
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId } }, video: false });
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    context = new AudioContext(); await context.resume(); await context.audioWorklet.addModule('pcm-worklet.js');
    tabSegments = new Segmenter(context.sampleRate, { maxSeconds: 3.5, silenceSeconds: .38, threshold: .005, peakThreshold: .04 }); micSegments = new Segmenter(context.sampleRate, { maxSeconds: 14, silenceSeconds: .85, threshold: .018 });
    const tabSource = await node(tabStream, chunk => {
      for (let i = 0; i < chunk.length; i += 8) { const v = Math.abs(chunk[i]); if (v > recentPeak) recentPeak = v; }
      saveDiag();
      if ((phase === 'watching' || (mode === 'karaoke' && phase === 'karaoke')) && performance.now() > armedAt) {
        const segment = tabSegments.push(chunk);
        if (segment) {
          diag.clips++; saveDiag('heard a clip, sending it to Meta…');
          if (mode === 'karaoke') analyzeKaraoke(segment);
          else if (mode === 'rehearse' || oneShot) { oneShot = false; analyze(segment); }
        }
      }
    }); tabSource.connect(context.destination);
    await node(micStream, chunk => {
      if (phase === 'karaoke') { streamMic(chunk); return; }
      if (phase !== 'listening' || performance.now() < armedAt) return;
      const started = micSegments.started, segment = micSegments.push(chunk);
      if (!started && micSegments.started) { for (const pre of micSegments.chunks.slice(0, -1)) streamMic(pre); }
      if (started || micSegments.started || segment) streamMic(chunk);
      if (segment) check(segment);
    });
    tabStream.getAudioTracks().forEach(t => t.onended = () => { stop(); emit({ type: 'state', phase: 'error', message: 'Tab sharing ended. Restart Ttaku to reconnect.' }); });
    phase = mode === 'karaoke' ? 'karaoke' : 'watching'; armedAt = performance.now() + 200; if (mode === 'karaoke') emit({ type: 'state', phase: 'karaoke', message: '' }); return { ok: true };
  } catch (error) { await stop(); throw error; }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.target !== 'audio' || sender.id !== chrome.runtime.id) return;
  const run = async () => {
    if (m.type === 'key-changed') { closeLive(); liveFailed = true; return { ok: true }; }
    if (m.type === 'start') return start(m);
    if (m.type === 'stop') { await stop(); return { ok: true }; }
    if (m.sessionId && m.sessionId !== sessionId) return;
    if (m.type === 'skip') { epoch++; if (phrase) advance(); else resume(); return { ok: true }; }
    if (m.type === 'retry' && phrase) { epoch++; listen('listening'); return { ok: true }; }
    if (m.type === 'replay' && phrase) { epoch++; closeLive(); phase = 'replay'; emit({ type: 'replay' }); return { ok: true }; }
    if (m.type === 'replay-ended') { listen(); return { ok: true }; }
    if (m.type === 'karaoke-cue' && mode === 'karaoke') { karaokeCaption(m.text); return { ok: true }; }
    if (m.type === 'phrase-repeat' && mode === 'phrase' && phase === 'watching') { emit({ type: 'seek-back', seconds: 10 }); return { ok: true }; }
    if (m.type === 'phrase-armed' && mode === 'phrase') { oneShot = true; tabSegments.reset(); armedAt = performance.now() + 60; return { ok: true }; }
    if (m.type === 'commit' || m.type === 'caption-boundary') {
      if (mode === 'phrase' && m.type === 'commit' && phase === 'watching') { emit({ type: 'seek-back', seconds: 10 }); return { ok: true }; }
      if (mode === 'karaoke' && phase === 'karaoke' && m.type === 'caption-boundary') { const s = tabSegments.finish(); if (s) analyzeKaraoke(s); }
      else if (phase === 'watching') { const s = tabSegments.finish(); if (s) { diag.clips++; if (mode === 'rehearse' || oneShot) { oneShot = false; analyze(s); } } } else if (phase === 'listening' && m.type === 'commit') { const s = micSegments.finish(); if (s) check(s); } return { ok: true };
    }
    if (m.type === 'video-paused' && phase === 'watching') { tabSegments.reset(); armedAt = Infinity; }
    if (m.type === 'video-playing' && phase === 'watching') { tabSegments.reset(); armedAt = performance.now() + 120; }
    return { ok: true };
  };
  run().then(reply, e => reply({ error: e.message })); return true;
});
