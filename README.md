# Ttaku - Speak fluent Japanese by watching anime

Ttaku turns the show you're already watching into a speaking partner.

A character says a line. The show pauses. You see how to say it in English letters (romaji), big and clear at the top of the video. You say it out loud — the words turn yellow as Ttaku hears them — and when you've got it, the show starts playing again.

No flashcards. No lessons. Just your show, and you, talking back to it.

## What it feels like

**Rehearse** — Like practicing with a patient friend. The show pauses after every line, shows you the words, and waits until you say them before it plays again. Grunts, laughs, and background noise don't stop the show — only real lines do. Too long a speech? You practice it piece by piece in the same pause. If you'd rather keep watching, just press Play and Ttaku lets the line go.

Everything you say is collected for you in a **word bank**: the words you find yourself saying all the time, plus any you tap to save while practicing.

## Getting started

You don't need to install anything or run any code. You just need Chrome and a free Meta Model API key (Ttaku listens with Meta's AI, and every user brings their own key).

1. Download this project (green **Code** button → **Download ZIP**) and unzip it.
2. In Chrome, go to `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and choose the `extension` folder.
3. Click the Ttaku icon in your toolbar. Hit the gear (⚙ Settings), paste your **Meta Model API key**, and click **Save**. Hit **Test connection** if you want to check it works.
4. Still in Settings, click **Allow access** for the microphone and say yes when Chrome asks.
5. Open an anime episode on Crunchyroll with Japanese audio, click the Ttaku icon, flip the **Practice** switch on.

That's it. Your key stays saved in the extension on your device — you only enter it once. To change or remove it later, it's in Settings.

**Want to try it without a streaming subscription?** The `test` folder in this project has a short practice clip and page. Serve that folder with any static file server (for example `python3 -m http.server` inside `test`), open the page, and practice on it the same way.

## Good to know

- **Your key, your business.** Your API key is only ever sent to Meta from inside the extension. It never touches the web page, the show, or anyone else. Your word bank and progress live in your browser, not on a server.
- **It's judging your reading, not your accent.** Ttaku checks that the words you said match the line. It doesn't grade pronunciation or pitch — yet.
- **Sometimes it mishears.** Crowded scenes, songs, shouting over explosions — if a line comes out wrong, Replay it, Skip it, or just press Play and keep watching.
- Lines only pause when they're worth practicing. One-word shouts and laughs play straight through.

## Under the hood (for the curious and the judges)

- `muse-voice-transcribe-1.0` (Meta Model API) hears both sides: completed-audio transcription for the show's lines and for checking your attempts, and a realtime WebSocket stream that fills the words in yellow as you speak.
- `muse-spark-1.3` turns what was heard into practice lines — hiragana readings, romaji, word-by-word alignment, plus translations and vocabulary that load quietly in the background.
- The answer you're supposed to say is never sent to the speech recognizer, so it can't cheat. Matching is done locally in the extension.
- Built for the Meta Global AI Developer Hackathon. The popup, overlay, and practice flow evolve from an earlier personal build called Taku; the localhost helper and OpenAI plumbing were replaced with direct Meta Model API calls, a bring-your-own-key popup, and the current mode system.

## Trying the code

```sh
npm test   # Node 18+, nothing to install
```

See `VERIFICATION.md` for what has and hasn't been tested, and `SECURITY_SCAN.md` for the pre-publication secret scan.
