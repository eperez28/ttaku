// Offscreen document: tab + microphone capture, segmentation, and the live
// Meta realtime stream. HTTP Meta calls are delegated to the service worker;
// the expected line never leaves this document for ASR or reading conversion.
import { Segmenter, wav24Base64, pcm24Bytes } from './audio-utils.js';
import { recognizedPrefix, recognizedMatches, matchCoverage, compactLines, isPauseWorthy, punctuateLine, expandContractions, normalizeFiller, mergeRepeats, repeatKey, pickPracticeLine, isSubstantialLine, combineLines, cleanJapanese } from './word-progress.js';
import { matchReading, normalizeReading } from './matching.js';
import { META_WS, buildHandshake, isHandshakeAck, cumulativeTranscript } from './meta-protocol.js';

let context, tabStream, micStream, sessionId, phase = 'off', phrase = null, lines = [], lineIndex = 0, tabSegments, micSegments, epoch = 0, armedAt = 0;
let live = null, liveReady = false, liveQueue = [], liveFailed = false, liveEndTimer = null;
let apiKeyCache = null;
let helpTimer = null;
let attemptParts = [], lastLiveHeard = '';
let pendingCaption = '', pendingCaptionAt = 0;
let sourceLive = null, sourceReady = false, sourceQueue = [], sourceFailed = false;
function closeSourceLive() { const ws = sourceLive; sourceLive = null; sourceReady = false; sourceQueue = []; if (ws) { try { ws.close(); } catch {} } }
function openSourceLive() {
  if (sourceLive || sourceFailed || !apiKeyCache) return;
  let ws;
  try { ws = new WebSocket(META_WS); } catch { sourceFailed = true; return; }
  sourceLive = ws; ws.binaryType = 'arraybuffer';
  ws.onopen = () => { try { ws.send(JSON.stringify({ ...buildHandshake(apiKeyCache), mode: 'ENDPOINTING' })); } catch {} };
  ws.onmessage = e => {
    if (ws !== sourceLive || typeof e.data !== 'string') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (isHandshakeAck(m)) { sourceReady = true; for (const f of sourceQueue) { try { ws.send(f); } catch {} } sourceQueue = []; return; }
    if (m.type === 'error') { sourceFailed = true; closeSourceLive(); return; }
    // Meta heard a voice stop — that is a line ending, whatever else is
    // making noise. Cut the clip right there instead of waiting for the
    // whole soundtrack to go quiet.
    if (m.type === 'speechEnd' && phase === 'watching') {
      const s = tabSegments?.finish();
      if (s) { diag.clips++; saveDiag('Meta heard the line end, pausing'); emit({ type: 'pause', duration: s.duration, delaySeconds: .15 }); emit({ type: 'state', phase: 'processing', message: 'Getting this line…' }); analyze(s, true); }
    }
  };
  ws.onerror = () => { sourceFailed = true; };
  ws.onclose = () => { if (ws === sourceLive) { sourceLive = null; sourceReady = false; sourceQueue = []; } };
}
function streamSource(chunk) {
  if (sourceFailed || phase === 'off') return;
  if (!sourceLive) { openSourceLive(); if (!sourceLive) return; }
  const bytes = pcm24Bytes(chunk, context.sampleRate);
  const frame = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (sourceReady && sourceLive?.readyState === WebSocket.OPEN) { try { sourceLive.send(frame); } catch { sourceFailed = true; } }
  else if (sourceQueue.length < 240) sourceQueue.push(frame);
}
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
    if (partial && phase === 'listening') lastLiveHeard = partial.text;
    // Each cumulative partial replaces the last one; fill every word it
    // matches, even if an earlier word was misheard.
    if (partial && phrase && ['listening', 'checking'].includes(phase)) {
      const { mask, partial: part } = recognizedMatches(phrase.tokens || [], partial.text);
      emit({ type: 'word-progress', count: mask.filter(Boolean).length, mask, part });
      if (phase === 'listening' && mask.length && (mask.every(Boolean) || (mask[mask.length - 1] && matchCoverage(phrase.tokens || [], mask) >= 0.8))) acceptLive();
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
function listen(phaseName = 'listening') { phase = 'listening'; micSegments.reset(); armedAt = performance.now() + 150; saveDiag('paused, waiting for you to repeat it'); emit({ type: 'word-progress', count: 0 }); emit({ type: 'state', phase: phaseName, message: '' }); openLive(); clearTimeout(helpTimer); helpTimer = setTimeout(() => { if (phase === 'listening') emit({ type: 'struggle-help' }); }, 12000); }
async function ensureBuiltLine(index) {
  const item = lines[index]; if (!item) return null;
  if (!item.pendingTurn) return item;
  const turnText = item.pendingTurn;
  const built = await meta({ type: 'phrase-display', text: turnText }).catch(() => null);
  if (!built || built.error || built.empty) return null;
  const builtLines = compactLines(built.lines?.length ? built.lines : [built]).filter(l => l.romaji && l.reading && /[\u3040-\u30ff\u3400-\u9fff]/.test(l.japanese || '')).map(l => punctuateLine(expandContractions(normalizeFiller(l))));
  if (!builtLines.length) return null;
  lines.splice(index, 1, ...builtLines);
  const target = lines[index];
  meta({ type: 'phrase-text', text: turnText }).then(r => {
    if (!r || r.error || r.empty || phrase !== target) return;
    const full = (r.lines?.length ? r.lines : [r]);
    const match = full.find(l => l.japanese === target.japanese) || full[0];
    if (match?.tokens?.length) { target.tokens = match.tokens; if (match.reading) target.reading = match.reading; emit({ type: 'phrase-tokens', tokens: match.tokens }); }
  }).catch(() => {});
  return target;
}
async function showLine() {
  attemptParts = []; lastLiveHeard = '';
  let current = await ensureBuiltLine(lineIndex);
  while (!current && lineIndex + 1 < lines.length) { lineIndex++; current = await ensureBuiltLine(lineIndex); }
  if (!current) { resume(); return; }
  phrase = lines[lineIndex]; emit({ type: 'phrase', phrase, lineIndex, lineCount: lines.length }); listen();
  const shown = phrase;
  meta({ type: 'phrase-enrich', japanese: shown.japanese, romaji: shown.romaji }).then(r => {
    if (r && !r.error && phrase === shown) { shown.meaning = r.meaning || ''; shown.words = r.words || []; emit({ type: 'phrase-details', meaning: shown.meaning, words: shown.words }); }
  }).catch(() => {});
}
async function advance() { closeLive(); if (lineIndex + 1 < lines.length) { epoch++; lineIndex++; await showLine(); } else resume(); }
async function analyze(segment, prePaused = false) {
  const ticket = ++epoch; phase = 'processing'; const startedAt = performance.now();
  // The old Taku shape: the video is already paused; one transcription
  // call, one line-building call, then the complete block goes on screen.
  try {
    const wav = wav24Base64(segment.chunks, context.sampleRate);
    const heard = await meta({ type: 'transcribe', audioBase64: wav });
    if (heard?.error) throw Error(heard.error);
    if (ticket !== epoch) return;
    const text = (heard?.text || '').trim();
    if (!isPauseWorthy(text, segment.duration)) {
      phase = 'watching'; tabSegments.reset(); armedAt = performance.now() + 180; saveDiag('not a pause-worthy line, letting it play');
      if (prePaused) emit({ type: 'resume' }); else emit({ type: 'state', phase: 'empty', message: '' });
      return;
    }
    saveDiag('Japanese line confirmed, pausing');
    if (!prePaused) emit({ type: 'pause', duration: segment.duration, delaySeconds: (performance.now() - startedAt) / 1000 });
    emit({ type: 'state', phase: 'processing', message: 'Getting this line…' });
    // Never display past a speaker change: if this clip holds several
    // sentences, diarization finds where the first speaker stops.
    let blockText = text;
    const multi = (text.match(/[。！？]/g) || []).length >= 2 || segment.duration > 4;
    if (multi) {
      try {
        const d = await meta({ type: 'diarize', audioBase64: wav });
        if (ticket !== epoch) return;
        const turns = d && !d.error && Array.isArray(d.turns) ? d.turns.filter(tn => tn.text && /[\u3040-\u30ff\u3400-\u9fff]/.test(tn.text)) : [];
        if (turns.length && turns.some(tn => tn.speaker !== turns[0].speaker)) {
          const run = [];
          for (const tn of turns) { if (run.length && tn.speaker !== turns[0].speaker) break; run.push(tn); }
          if (run.length) { blockText = run.map(tn => tn.text).join(''); saveDiag('first speaker only, ' + run.length + ' turn(s)'); }
        }
      } catch {}
    }
    const caption = Date.now() - pendingCaptionAt < 15000 ? pendingCaption : '';
    const built = await meta({ type: 'phrase-display', text: blockText, caption });
    if (built?.error) throw Error(built.error);
    if (ticket !== epoch) return;
    const rawLines = built.empty ? [] : compactLines(built.lines?.length ? built.lines : [built]).filter(l => l.romaji && l.reading && /[\u3040-\u30ff\u3400-\u9fff]/.test(l.japanese || '')).map(l => punctuateLine(expandContractions(normalizeFiller(l))));
    const block = combineLines(rawLines);
    lines = block ? [block] : [];
    if (!lines.length) {
      phase = 'watching'; tabSegments.reset(); armedAt = performance.now() + 180; saveDiag('only fragments in that clip, letting it play');
      if (prePaused) emit({ type: 'resume' }); else emit({ type: 'state', phase: 'empty', message: '' });
      return;
    }
    lineIndex = 0; await showLine();
    // Precise token alignment swaps in behind the block, keeping any fill.
    const shown = phrase;
    if (!shown) return;
    meta({ type: 'phrase-text', text: blockText, caption }).then(r => {
      if (!r || r.error || r.empty || phrase !== shown) return;
      const full = (r.lines?.length ? r.lines : [r]);
      const tokens = full.flatMap(l => l.tokens || []);
      if (tokens.length) { shown.tokens = tokens; shown.reading = full.map(l => l.reading || '').join(''); emit({ type: 'phrase-tokens', tokens }); }
    }).catch(() => {});
  } catch (error) { if (ticket === epoch) { phase = 'watching'; tabSegments.reset(); armedAt = performance.now() + 180; saveDiag('Meta error: ' + error.message); emit({ type: 'state', phase: 'error', message: error.message }); } }
}
async function check(segment) {
  const ticket = ++epoch; phase = 'checking'; closeLive(true); saveDiag('heard you, checking…'); emit({ type: 'state', phase, message: '' });
  try {
    const wav = wav24Base64(segment.chunks, context.sampleRate);
    const heardResult = await meta({ type: 'attempt-reading', audioBase64: wav });
    if (heardResult?.error) throw Error(heardResult.error);
    if (ticket !== epoch) return;
    const judge = r => {
      const a = matchReading(phrase.reading, r.reading || '');
      const b2 = matchReading(phrase.reading, r.heard || '');
      const base = b2.similarity > a.similarity ? { heard: r.heard || '', ...b2 } : { heard: r.heard || '', ...a };
      // Also grade word by word: most of the line said in order is a pass,
      // even when the recognizer garbles the sounds between the words.
      const coverage = Math.max(
        matchCoverage(phrase.tokens || [], recognizedMatches(phrase.tokens || [], r.reading || '').mask),
        matchCoverage(phrase.tokens || [], recognizedMatches(phrase.tokens || [], r.heard || '').mask)
      );
      return { ...base, coverage, passed: base.passed || (coverage >= 0.75 && base.similarity >= 45) };
    };
    // One attempt can span several breaths: keep the pieces and judge the
    // whole thing, not just the fragment that happened to end a segment.
    attemptParts.push({ heard: heardResult.heard || '', reading: heardResult.reading || '' });
    const combined = { heard: attemptParts.map(x => x.heard).join(''), reading: attemptParts.map(x => x.reading).join('') };
    let result = judge(heardResult);
    if (attemptParts.length > 1) { const combinedResult = judge(combined); if (combinedResult.similarity > result.similarity) result = combinedResult; }
    if (!result.passed && lastLiveHeard) { const liveResult = judge({ heard: lastLiveHeard, reading: '' }); if (liveResult.similarity > result.similarity) result = liveResult; }
    if (!result.passed) {
      const alt = await meta({ type: 'attempt-reading-alt', audioBase64: wav }).catch(() => null);
      if (ticket !== epoch) return;
      if (alt && !alt.error && alt.heard) {
        const altResult = judge(alt);
        const altCombined = judge({ heard: attemptParts.slice(0, -1).map(x => x.heard).join('') + alt.heard, reading: attemptParts.slice(0, -1).map(x => x.reading).join('') + (alt.reading || '') });
        const best = altCombined.similarity > altResult.similarity ? altCombined : altResult;
        if (best.similarity > result.similarity) result = best;
      }
    }
    if (!result.passed) {
      // They paused mid-line: the attempt so far is a clean start of the
      // line. That is not a failure — keep listening for the rest of it.
      const expectedN = normalizeReading(phrase.reading);
      const heardN = normalizeReading(combined.reading || combined.heard);
      if (attemptParts.length < 3 && heardN.length >= 2 && expectedN.startsWith(heardN)) {
        saveDiag('mid-line pause, still listening');
        phase = 'listening'; micSegments.reset(); armedAt = performance.now() + 120;
        emit({ type: 'state', phase: 'listening', message: '' }); openLive(); return;
      }
    }
    saveDiag(result.passed ? 'repeat accepted, playing again' : 'repeat not accepted (match ' + result.similarity + '%, words ' + Math.round((result.coverage || 0) * 100) + '%)');
    emit({ type: 'result', ...result });
    if (result.passed) { phase = 'passed'; emit({ type: 'word-progress', count: phrase.tokens?.length || 100 }); await chrome.runtime.sendMessage({ target: 'worker', type: 'passed', words: (phrase.words?.length ? phrase.words : (phrase.tokens || []).map(tok => ({ japanese: tok.japanese || '', reading: tok.reading || '', romaji: tok.romaji || '', meaning: '' }))) }); setTimeout(() => { if (ticket === epoch) advance(); }, 650); }
    else { phase = 'retry'; emit({ type: 'struggle-help' }); emit({ type: 'state', phase, message: result.heard ? 'Try that line again.' : 'I couldn’t hear you.' }); setTimeout(() => { if (ticket === epoch) listen('retry'); }, 1300); }
  } catch (error) { if (ticket === epoch) { phase = 'error'; saveDiag('repeat check failed: ' + error.message); emit({ type: 'state', phase, message: error.message }); } }
}
function resume() { epoch++; closeLive(); openSourceLive(); phase = 'watching'; phrase = null; lines = []; lineIndex = 0; tabSegments.reset(); micSegments.reset(); armedAt = performance.now() + 180; emit({ type: 'resume' }); emit({ type: 'state', phase, message: '' }); }
async function stop() { epoch++; closeLive(); closeSourceLive(); apiKeyCache = null; phase = 'off'; for (const stream of [tabStream, micStream]) stream?.getTracks().forEach(t => t.stop()); tabStream = micStream = null; if (context) { await context.close(); context = null; } }
async function start(m) {
  await stop(); sessionId = m.sessionId; apiKeyCache = null; getApiKey(); diag = { peak: 0, rms: 0, started: false, armed: false, clips: 0, outcome: 'waiting to hear the video', at: Date.now() }; recentPeak = 0; saveDiag();
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId } }, video: false });
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }, video: false });
    context = new AudioContext(); await context.resume(); await context.audioWorklet.addModule('pcm-worklet.js');
    tabSegments = new Segmenter(context.sampleRate, { maxSeconds: 6, silenceSeconds: .25, threshold: .005, peakThreshold: .04 }); micSegments = new Segmenter(context.sampleRate, { maxSeconds: 20, silenceSeconds: 1.1, threshold: .01 });
    const tabSource = await node(tabStream, chunk => {
      for (let i = 0; i < chunk.length; i += 8) { const v = Math.abs(chunk[i]); if (v > recentPeak) recentPeak = v; }
      saveDiag();
      streamSource(chunk);
      if (phase === 'watching' && performance.now() > armedAt) {
        const segment = tabSegments.push(chunk);
        if (segment) {
          diag.clips++; saveDiag('heard a clip, sending it to Meta…');
          emit({ type: 'pause', duration: segment.duration, delaySeconds: .35 }); emit({ type: 'state', phase: 'processing', message: 'Getting this line…' }); analyze(segment, true);
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
    phase = 'watching'; armedAt = performance.now() + 200; openSourceLive(); return { ok: true };
  } catch (error) { await stop(); throw error; }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.target !== 'audio' || sender.id !== chrome.runtime.id) return;
  const run = async () => {
    if (m.type === 'key-changed') { closeLive(); closeSourceLive(); sourceFailed = false; apiKeyCache = null; getApiKey(); liveFailed = true; return { ok: true }; }
    if (m.type === 'start') return start(m);
    if (m.type === 'stop') { await stop(); return { ok: true }; }
    if (m.sessionId && m.sessionId !== sessionId) return;
    if (m.type === 'user-continue') { epoch++; closeLive(); resume(); return { ok: true }; }
    if (m.type === 'skip') { epoch++; if (phrase) advance(); else resume(); return { ok: true }; }
    if (m.type === 'retry' && phrase) { epoch++; listen('listening'); return { ok: true }; }
    if (m.type === 'replay' && phrase) { epoch++; closeLive(); phase = 'replay'; emit({ type: 'replay' }); return { ok: true }; }
    if (m.type === 'replay-ended') { listen(); return { ok: true }; }
    if (m.type === 'caption-boundary' && typeof m.caption === 'string' && m.caption) { pendingCaption = m.caption; pendingCaptionAt = Date.now(); }
    if (m.type === 'commit' || m.type === 'caption-boundary') {
      if (phase === 'watching') { const s = tabSegments.finish(); if (s) { diag.clips++; if (m.type === 'caption-boundary') { emit({ type: 'pause', duration: s.duration, delaySeconds: 0 }); emit({ type: 'state', phase: 'processing', message: 'Getting this line…' }); } analyze(s, m.type === 'caption-boundary'); } } else if (phase === 'listening' && m.type === 'commit') { const s = micSegments.finish(); if (s) check(s); } return { ok: true };
    }
    if (m.type === 'video-paused' && phase === 'watching') { tabSegments.reset(); armedAt = Infinity; }
    if (m.type === 'video-playing' && phase === 'watching') { tabSegments.reset(); armedAt = performance.now() + 120; }
    return { ok: true };
  };
  run().then(reply, e => reply({ error: e.message })); return true;
});
