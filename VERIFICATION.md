# Verification

## Automated tests — fixtures only
`npm test`: 28 tests, all passing.
- Original suite (18): PCM/WAV encoding, segmentation, reading matching, player pause/resume/replay guards, hollow-romaji word fill, line splitting.
- New Meta suite (10): realtime handshake shape, handshake-ack detection, cumulative-partial replacement feeding word fill (partial line fills only matching romaji), completed-audio request shape (no expected answer), 48k→24k WAV resampling, raw PCM16 frame bytes, `muse-spark-1.3` `text.format` body (reading conversion receives only the transcript), structured-output validation, credential-free error mapping, transcript extraction.

## Against the real Meta API
- **Invalid-key test ran against real Meta** (2026-11-04): in a clean Chrome-for-Testing profile, saving a fake key and clicking the Test-connection path returned Meta's rejection, mapped to "Meta rejected that API key. Check the key and try again." — no credential echoed.
- **Missing-key test ran**: after Clear, Test returns "Enter your Meta Model API key in the Ttaku popup first."
- **Not run with a valid key:** no valid Meta key was available in the build environment, so a successful `transcribe` / `realtime` / `responses` practice loop (live partial fill, final acceptance, playback resume against Meta) has not been executed. That remains the one judge-side smoke test; the wire formats follow the official docs and the same flows are covered by fixtures below.
- Live-disconnect fallback: covered by fixtures/code path — realtime errors set a failed flag, streaming stops, and the completed-audio check in `check()` still runs.

## Chrome
- Verified in a clean Chrome-for-Testing profile (branded Chrome 156 ignores `--load-extension`, so Chrome for Testing was used): the Ttaku service worker registers, the popup renders with the masked Meta key field and Save / Test connection / Clear, saving clears the input and reports session-only storage, and Clear ends the saved state. Full microphone practice loop requires a headed Chrome, a microphone, and a valid Meta key, so it was not completed end-to-end here.

## Secret scan
Tracked files, full git history, and the distributable ZIP were scanned for credential patterns, the old pairing token, `.env*` values, and private runtime state before publication. Findings (paths/commit IDs only, no values) are in `SECURITY_SCAN.md`.
