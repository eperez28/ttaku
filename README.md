# Ttaku — speak along with Japanese video

Chrome extension for the Meta Global AI Developer Hackathon. Hear a short Japanese line from a video, repeat it into the microphone, watch the matching romaji fill as you speak, and playback resumes once the attempt passes.

Ttaku keeps the original Taku toolbar popup, fullscreen overlay, practice controls, and saved-word bank. What changed for the Meta submission is underneath: no localhost helper, no pairing token, no `.env.local`, and no Node step to run it. Your own Meta Model API key goes straight from the popup to Meta.

## Load it from a fresh clone

```sh
git clone <this-repo> ttaku
cd ttaku
```

Nothing to install or build — there are no runtime dependencies.

1. Open `chrome://extensions` in Chrome, turn on **Developer mode**, click **Load unpacked**, and select the `extension/` folder in this repo.
2. Click the Ttaku toolbar icon. Open **Settings** (gear icon), paste your **Meta Model API key** into the masked field, and click **Save**. Change or clear it there anytime. (Optional: **Test connection**.) The key is stored in `chrome.storage.local` (extension-only storage that web pages cannot read), so it stays saved after Chrome restarts and extension reloads. **Clear** removes it and ends any active Meta sessions.
3. In the popup, click **Allow microphone** and choose **Allow** in the permission window.

## Judge walkthrough (no streaming subscription)

This repo ships an original, redistributable test clip (`test/demo-line.mp4`, a synthetic Kyoko-voice recording of 「大丈夫ですか」 made for this repo) and a test page.

```sh
cd test && python3 -m http.server 8123   # static files only; Ttaku itself needs no server
```

1. Open `http://127.0.0.1:8123/demo.html`, save your Meta key in the Ttaku popup, allow the microphone, and click **Start practice**.
2. Press Play. Ttaku pauses after the line and shows the romaji hollow: *daijoubu desu ka*.
3. Say only 「大丈夫」 — only *daijoubu* fills. Say the whole line — the rest fills, the final completed-audio check runs, and playback resumes on a pass.

For real anime, open a Crunchyroll episode with Japanese audio instead and click **Start practice** the same way.

## How it works

- **Source clips & final check** — `muse-voice-transcribe-1.0`, `POST https://api.meta.ai/v1/asr/transcribe`, multipart `request` (JSON, `languageBias: ["Japanese"]`) + `audio` (mono PCM16 WAV at 24 kHz), bearer auth from the service worker.
- **Live fill** — `muse-voice-transcribe-1.0` at `wss://api.meta.ai/v1/asr/realtime`, opened from the offscreen document: auth in the first JSON handshake (`authorization.accessToken`), wait for the session acknowledgement, then raw 24 kHz mono PCM16 binary frames, `{"type":"endStream"}` to finalize. `PUSH_TO_TALK` with cumulative partials: each partial replaces the last and feeds the existing word-matching, so romaji fills word by word. If streaming fails, the completed-audio final check still decides the attempt.
- **Japanese text** — `muse-spark-1.3`, `POST https://api.meta.ai/v1/responses` with `text.format` JSON Schema (the original phrase and learner-reading schemas): short single lines, hiragana readings, spaced romaji, token alignment, English meanings, vocabulary. Output is validated before use. The learner-reading conversion receives only the recognized transcript; the expected answer is never sent to ASR or to the reading conversion.

The key is never sent to a content script, page, overlay, log, or any origin other than `api.meta.ai`.

## Reused vs. changed

**Reused from the initial Taku build:** toolbar popup, fullscreen/player overlay and hollow-romaji fill, practice controls (replay / 0.75× / retry / done / details / skip), word bank, line splitting, word-progress matching, reading matching, and the original test suite (18 tests).

**Changed for the Meta submission:** localhost helper, pairing token, `.env.local`, and Node startup removed; OpenAI models/endpoints replaced by the three Meta paths above; API key entered in the popup and kept in session storage; matching moved into the extension; WAV resampled to 24 kHz for Meta; host permissions scoped to Crunchyroll, the local test page, and `api.meta.ai`; brand updated to Ttaku.

## Tests

```sh
npm test   # Node 18+, no dependencies to install
```

See `VERIFICATION.md` for what was verified, and against what.
