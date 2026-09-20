# Jarves

A personal assistant that lives on your phone and remembers you.

Installable web app — no App Store, no developer account, no Mac. Everything it
knows is stored on your device and nothing leaves it.

**Status: v0.1.0 — the shell.** Memory, notes and the email surface are real and
working. Reasoning is not connected yet; see [Giving it a brain](#giving-it-a-brain).

---

## Install it on your phone

1. Serve the `jarves/` folder over HTTPS. GitHub Pages works: repo → Settings →
   Pages → deploy from this branch. Your app lands at
   `https://<user>.github.io/<repo>/jarves/`.
2. Open that URL in **Chrome on Android**.
3. Menu → **Add to Home screen**. It installs with its own icon and opens
   full-screen, no browser bars.

Voice needs HTTPS and microphone permission. `http://localhost` also counts as
secure, which is what local development uses.

To run it locally:

```bash
cd jarves
python3 -m http.server 8731
# open http://localhost:8731
```

A plain `file://` open will *not* work — the app uses ES modules, which need a
real server.

## What works today

| Say this | What happens |
| --- | --- |
| `remember that I shoot content on Thursdays` | Stored as a durable fact, forever |
| `what do you know about the shoot` | Searches everything it knows |
| `forget that …` | Drops the matching fact |
| `note: call Tom about the rate card` | Timestamped note |
| `show my notes` | Lists them |
| `check my email` / `any unread` | Lists the inbox |
| `read the one from Nadia` | Opens the full message |
| `help` | The current capability list |

Tap the mic to talk instead of type. Replies are spoken aloud; the speaker icon
in the top bar mutes that.

**The email is a sample mailbox.** No real account is connected, and Jarves says
so every time it shows you mail. See [Connecting real email](#connecting-real-email).

Anything outside that list gets an honest "I can't do that yet" rather than an
invented answer. That is deliberate — an assistant that bluffs is worse than one
that admits its limits.

## Giving it a brain

The shell brain is rules, not intelligence. For real reasoning it needs a model,
and a model needs an API key — which can never be shipped inside the app, because
anyone who installs it could read it. So the key lives in a tiny server-side
function instead.

```bash
cd jarves/backend
npm install -g wrangler
wrangler login
wrangler deploy
wrangler secret put ANTHROPIC_API_KEY   # from console.anthropic.com
wrangler secret put SHARED_SECRET       # any long random string
```

Then edit `ALLOWED_ORIGINS` in `worker.js` to wherever you're serving the app,
redeploy, and in the app: **menu → Brain → paste the worker URL and secret →
Connect**.

### What it costs

Cloudflare's free tier covers the worker comfortably. You pay Anthropic per
token. Jarves runs on **Claude Opus 5** ($5 per million input tokens, $25 per
million output), which works out to roughly **3¢ per conversational turn** —
call it a few dollars a month at personal volume.

If that's more than you want to spend, change `MODEL` in `js/brain/claude.js`
to `claude-sonnet-5` — about 2.5× cheaper, and still very capable. That's a
deliberate choice to make yourself rather than a default I picked for you.

### Request settings worth knowing

Set in `js/brain/claude.js`, all commented in place:

- `EFFORT = 'medium'` — how hard the model thinks. This is a voice assistant, so
  replies need to *start* fast. Raise to `'high'` if answers feel shallow.
- `MAX_TOKENS = 16000` — a ceiling, not a target. Brevity comes from the system
  prompt; a low ceiling just truncates long answers mid-sentence.
- `fallbacks: 'default'` — if Opus 5's safety classifiers decline a request, the
  API retries it on a suitable model inside the same call instead of failing.
- Adaptive thinking is on, which is the current default for this model family.

Once connected, every tool becomes available to the model automatically.
Nothing else changes.

## Connecting real email

`js/tools/email.js` talks to an **adapter**, and currently uses `mockAdapter`.
To connect Gmail for real, write an object with the same four methods
(`name`, `isLive`, `list`, `read`, `draft`), then call `setAdapter(yourAdapter)`.

The OAuth token has to be held by the backend for the same reason the API key
is — so the Gmail adapter is a few more routes on the worker, not browser code.

Jarves drafts mail. It does not send it, and there is no code path that can.

## How it's built

```
jarves/
  index.html            app shell
  css/app.css           Aperture Gold & Silver, carried over from the calendar
  js/
    app.js              boot and wiring
    ui.js               all DOM work; escapes before it formats
    memory.js           IndexedDB — facts, notes, conversation
    voice.js            speech in and out, with the Android quirks handled
    brain/
      index.js          picks a brain, falls back if one dies
      local.js          the rule-based shell brain (works offline, no key)
      claude.js         the real brain (needs an endpoint)
    tools/
      index.js          the registry
      memory.js         remember / recall / forget / notes
      email.js          list / read / draft, behind an adapter
  backend/worker.js     holds the API key
  test/e2e.mjs          drives the real app in a real browser
```

Two ideas hold the whole thing together:

**Tools are declared once, in the Messages API's schema shape.** Both brains call
the same `tools.run()`. So a tool written today works on the shell brain now, and
the moment a model is connected it can call that same tool with no changes.

**The local brain never goes away.** When the model is unreachable — no signal,
rate limit, bad key — `brain/index.js` catches it, answers on the shell brain
instead, and tells you it did. An assistant that dies without a network is not
an assistant.

### Adding a capability

```js
// js/tools/weather.js
import { register } from './index.js';

register({
  name: 'get_weather',
  description: 'Current conditions for a place.',
  input_schema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  async run({ city }) {
    const r = await fetch(`https://api.example.com/w?q=${encodeURIComponent(city)}`);
    return await r.json();
  },
});
```

Import it in `app.js` next to the others. That's the whole step — the model can
now use it. Teaching the *shell* brain to trigger it takes a pattern in
`brain/local.js`, but that's optional.

## Tests

```bash
npm install playwright
cd jarves && python3 -m http.server 8731 &

node test/e2e.mjs      # 28 checks — the app, in a real browser at phone size
node test/wire.mjs     # 17 checks — the API request shape and the tool loop
node test/worker.mjs   # 12 checks — the backend, no browser needed
```

**e2e** drives every command above, memory surviving a reload, the service
worker, the theme toggle, and the fallback path when the endpoint is dead.

**wire** points the app at a mock Anthropic endpoint and asserts the request we
*would* send is correct — model, token ceiling, thinking, refusal fallbacks,
tool schemas — then drives a full `tool_use → tool_result → text` round trip and
confirms the tool really wrote to IndexedDB. Costs nothing and needs no key, so
it can run before you ever deploy the worker.

**worker** runs the Cloudflare handler in Node against a stubbed upstream:
the `betas` → `anthropic-beta` header translation, the spend cap, auth
rejection, CORS, and that the API key never reaches the client.

## Known limits

- **No background wake word.** A web app cannot listen while your phone is
  locked. Getting "Hey Jarves" from a locked screen means a native Android
  wrapper with a foreground service — a real project of its own, and the reason
  this starts as a PWA.
- **Recall is keyword matching**, not semantic. It finds "rate card" if you said
  "rate card". Embeddings are the upgrade, and `memory.js` has the seam for it.
- **The shell brain is rules.** It routes commands; it does not understand.
- **Memory is per-device.** Export from the drawer to move it.

## Roadmap

1. Connect the model — the single biggest jump in capability
2. Real Gmail via the worker
3. Calendar, wired to the Raw Social Media Calendar app
4. Semantic recall
5. Native Android wrapper for the always-on wake word
