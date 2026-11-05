# Pre-publication secret scan

Latest scan: 2026-11-04 (before making the repo public). Secret values are never printed here.

## Scope
- All tracked files.
- Full git history (every blob of every commit, from `06d570e6` to the current HEAD).
- Distributable ZIP built from `extension/` (16 entries).

## Findings
- **No real credential found anywhere.** No Meta/OpenAI-style API keys, no bearer-token values, no `.env*` files, and no private runtime state in tracked files, history, or the ZIP.
- The original Taku pairing-token **value** (from the initial build's `extension/config.js`, deliberately not imported) was checked against the full history and tracked files of this repo: **not present**. The initial-import commit (`06d570e6`) still contains references to the old token *mechanism* (`extension/offscreen.js`, `extension/setup.js`) — variable names, not values.
- `tests/meta-protocol.test.mjs` previously contained a synthetic alphabet-string fixture used to test credential redaction. It was not a real key and has been replaced with a runtime-built fake so scanners stay quiet.

## Publication status
- **Not blocked.** No credential was ever committed to this repo, so no revocation/rotation or history rewrite is required.
- Note: the original pairing token still exists in the separate, private initial-build workspace. It only ever gated a localhost helper that this submission deletes; rotate it there if that workspace is ever shared.
