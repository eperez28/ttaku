# Pre-publication secret scan

Scanned 2026-11-04. Secret values are never printed here.

## Scope
- All tracked files in this repo.
- Full git history (commits `06d570e6` and `daf8ddc9`).
- Distributable ZIP built from `extension/` (`ttaku-extension.zip`, 16 entries).

## Findings
- **No real credential found.** No API-key-shaped values, no bearer-token values, and no `.env*` files with values in tracked files, history, or the ZIP.
- The original Taku pairing-token **value** (from the initial build's `extension/config.js`, which was deliberately not imported) was checked against the full history of this repo: **not present**. Only references to the old token mechanism remain in the initial-import commit (`06d570e6`: `extension/offscreen.js`, `extension/setup.js`), and the localhost helper URL itself, which is not a credential. The submitted commit (`daf8ddc9`) removes all of it.
- Word-level matches for "pairing" / ".env" in `README.md` and `VERIFICATION.md` are prose explaining their removal, not values.

## Publication status
- **Not blocked.** No credential was ever committed to this repo, so no revocation/rotation or history rewrite is required for this repo.
- Note: the original pairing token still exists in the separate, private initial-build workspace. It only ever gated a localhost helper that this submission deletes; rotate it there if that workspace is ever shared.
