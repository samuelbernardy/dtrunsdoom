# DynaDoom

A [Dynatrace App](https://developer.dynatrace.com/develop/apps/) that embeds a fully playable Doom (shareware Episode 1) in the Dynatrace platform, built as a bootcamp showcase of what the AppEngine can host.

> "Yes, it will Doom."

---

## What it does

The app adds a `/doom` route to a standard Dynatrace App shell. Clicking **CLICK TO PLAY DOOM** boots Doom Episode 1 inside a DOSBox instance compiled to WebAssembly, running entirely in the browser with no backend involvement.

---

## Project structure

```
app.config.json               # App metadata: name, version, ID, environmentUrl, scopes
package.json                  # postinstall copies js-dos WASM files into ui/assets/
eslint.config.mjs             # ESLint flat config — binary WASM files excluded from parsing
ui/
  main.tsx                    # React entry point
  app/
    App.tsx                   # Router — adds /doom route
    components/
      Header.tsx              # Top nav — adds "Play Doom" link
      DoomEmbed.tsx           # Core canvas component (js-dos v6 + DOSBox WASM)
    pages/
      Doom.tsx                # /doom page — Strato chrome wrapping DoomEmbed
  assets/
    js-dos/                   # js-dos v6 static files (copied by postinstall)
      js-dos.js               # IIFE bundle — sets window.Dos
      wdosbox.js              # Emscripten JS wrapper for DOSBox
      wdosbox.wasm.js         # DOSBox compiled to WASM (~1.7 MB)
    doom/
      doom-shareware.zip      # DOOM.EXE + DOOM1.WAD at zip root (2 MB)
```

---

## How it works

`DoomEmbed` loads `js-dos.js` as a `<script>` tag (it is a browser-only IIFE that sets `window.Dos`). Once loaded, it calls `Dos(canvas, { wdosboxUrl })` which returns a promise-like object. Inside its `.ready()` callback, it fetches and extracts the shareware zip into DOSBox's virtual filesystem, then runs `DOOM.EXE`.

Boot is gated behind a click overlay so the browser's AudioContext policy is satisfied before the emulator starts.

---

## Trials and errors

This section documents every non-obvious obstacle encountered during development, so the next person doesn't have to rediscover them.

### 1. Static files must live in `ui/assets/`, not `public/`

**Symptom:** `Failed to load http://localhost:3001/js-dos/js-dos.js`

**Root cause:** dt-app's dev server is [Fastify](https://fastify.dev/), not a plain Vite dev server. Fastify only routes paths beginning with `/ui/` to the local filesystem. Everything else is proxied to the remote Dynatrace environment, which has no knowledge of your local files.

The standard Vite convention of placing static assets in `public/` does **not** work with dt-app — those files are never served in development.

**Fix:** Move all runtime-loaded static files to `ui/assets/`. dt-app's internal file handler maps `ui/assets/*` → `/ui/assets/*` in both the dev server and the production build (`dist/ui/assets/`). Update all URL construction to use `window.location.origin + '/ui/assets/...'`.

---

### 2. js-dos WASM files must be copied into the project

js-dos ships `wdosbox.js` and `wdosbox.wasm.js` inside `node_modules/js-dos/dist/`. These files are not bundled by Vite (they are loaded at runtime via XHR), so they must be copied into `ui/assets/` explicitly.

The `postinstall` script in `package.json` handles this so it survives `npm ci`:

```json
"postinstall": "mkdir -p ui/assets/js-dos ui/assets/doom && cp node_modules/js-dos/dist/js-dos.js node_modules/js-dos/dist/wdosbox.js node_modules/js-dos/dist/wdosbox.wasm.js ui/assets/js-dos/"
```

Both `wdosbox.js` and `wdosbox.wasm.js` must live at the **same URL base** — `compileWasmDosBox()` inside js-dos derives the WASM URL by replacing `.js` with `.wasm.js` on the JS wrapper path.

---

### 3. ESLint tries to parse `wdosbox.wasm.js` as JavaScript

**Symptom:** `Parsing error: Unexpected character ' '` during `npm run lint`

**Root cause:** `wdosbox.wasm.js` has a `.js` extension but is a raw binary WASM file. ESLint attempts to parse it as JavaScript and fails immediately.

**Fix:** Add `**/ui/assets/js-dos/**` to `globalIgnores` in `eslint.config.mjs`.

---

### 4. The shareware zip was the original 1995 installer, not game files

**Symptom:** `Can't extract zip, retcode 1` → then `illegal command DOOM.EXE`

**Root cause:** The widely-distributed `doom19s.zip` is **not** a zip containing `DOOM.EXE`. It is the original 1995 self-extracting installer in DICE split-archive format, containing:

```
DOOMS_19.1   ← MZ self-extracting PKZIP archive (part 1)
DOOMS_19.2   ← ZIP central directory continuation (part 2)
DEICE.EXE    ← DICE decompressor
```

DOSBox/js-dos cannot run `DEICE.EXE` or combine split archives at boot time. Passing this zip to `fs.extract()` results in either a retcode 1 extraction failure or a virtual filesystem with no `DOOM.EXE` at its root.

**Fix:** Combine the two parts and extract the actual game files on the host machine, then repackage:

```bash
cat DOOMS_19.1 DOOMS_19.2 | unzip -d doom-extracted -
# produces: DOOM.EXE (709 KB), DOOM1.WAD (4.0 MB), setup files

cd doom-extracted
zip ../doom-shareware.zip DOOM.EXE DOOM1.WAD
```

Place the resulting `doom-shareware.zip` (≈2 MB) at `ui/assets/doom/doom-shareware.zip`. The boot command is simply:

```ts
main(['-c', 'DOOM.EXE'])
```

---

### 5. js-dos overwrites canvas CSS dimensions at runtime

**Symptom:** After the emulator starts, the canvas shrinks to 640×400 regardless of the CSS `width`/`height` set on it.

**Root cause:** js-dos calls `canvas.style.width = '640px'` and `canvas.style.height = '400px'` (DOSBox's native output resolution) directly on the canvas element at runtime. Inline styles set by JavaScript override any CSS, including `width: 100%` in the element's own `style` prop.

**Fix:** A `MutationObserver` watches the canvas's `style` attribute and immediately resets it to `width: 100%; height: 100%` whenever js-dos overwrites it. A `suppressed` flag prevents the observer's own write from triggering an infinite loop. The containing div carries the actual display dimensions (e.g. 1280×800), and `imageRendering: pixelated` keeps pixels crisp at scale.

---

## Prerequisites

The Doom shareware WAD is freely redistributable by id Software for non-commercial use. Build and place the zip yourself:

1. Obtain `doom19s.zip` from [archive.org](https://archive.org) (search "doom19s").
2. Extract as described above (combine DOOMS_19.1 + DOOMS_19.2, unzip, repackage DOOM.EXE + DOOM1.WAD).
3. Place the result at `ui/assets/doom/doom-shareware.zip`.

Then:

```bash
npm install        # also runs postinstall — copies js-dos WASM files to ui/assets/js-dos/
npm run start      # dev server at localhost:3001
```

Navigate to the **Play Doom** nav item.

---

## Build & deploy

```bash
npm run build      # compiles to dist/ — must pass with zero errors
npm run lint       # ESLint — must pass with zero errors
npm run deploy     # builds and pushes to the environment in app.config.json
```
