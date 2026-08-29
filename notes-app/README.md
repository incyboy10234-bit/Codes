# My Notes

A private notes app for your own devices. It installs to your Home Screen like a
normal app, works with no internet, and keeps every note on your own phone —
there is no account, no server of ours, and nothing is sent anywhere unless you
switch on cloud sync yourself.

Works on iPhone, Android, laptop and tablet from the same web address.

---

## 1. Put it online (one time, ~5 minutes)

The app has to be served over `https://` for the "install to Home Screen" and
offline parts to work — opening the file directly from your phone's Files app
will not work. The easiest free way is GitHub Pages, since the code already
lives on GitHub.

1. Go to the repository on github.com → **Settings** → **Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick the branch this app is on, folder **/ (root)**, then **Save**.
4. Wait a minute or two. GitHub gives you an address like:

   `https://<your-username>.github.io/<repo-name>/notes-app/`

5. Open that address on your phone. That is your app.

Any other static host works too (Netlify, Cloudflare Pages, Vercel) — just point
it at the `notes-app` folder.

## 2. Install it on your phone

**iPhone / iPad** — must be Safari, other browsers cannot do this:
1. Open the address in **Safari**
2. Tap the **Share** button
3. Scroll down → **Add to Home Screen** → **Add**

**Android** — Chrome:
1. Open the address in Chrome
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen**)

**Laptop** — Chrome or Edge: click the install icon at the right of the address
bar. Or just use it in a browser tab.

Once installed it opens full screen with its own icon, and works with no signal.

---

## 3. Moving notes to another phone

Four ways, all built in. Open the **Transfer & Sync** button at the bottom of the
sidebar.

### Backup file — the reliable one
Exports everything (notes, notebooks, tags, images, attachments) to a single
`.json` file. Send it to the other phone however you like — AirDrop, WhatsApp,
email, a cable — and import it there. No internet needed.

Import comes in two flavours: **merge** (adds notes; where the same note exists
on both, the newer edit wins — nothing is lost) or **replace** (wipes the phone
first, then imports).

### QR code — no cables, no files
Show a QR on one phone, scan it with the other's camera. If there is more than a
screenful of notes it splits into several QR codes and cycles through them
automatically — keep the camera pointed until it says all parts are picked up.

Images and attachments are **not** included in a QR (far too much data). Use a
backup file for those.

### Paste code — works through any chat app
Turns your notes into a block of text you can copy into WhatsApp, Telegram,
Notes, an email — anything — and paste in on the other phone. Also no images.

### Cloud sync — automatic across phones
Syncs through **your own** free Firebase database. Your notes are encrypted on
your phone with your passphrase before they are uploaded, so the database only
ever holds scrambled data. Setup is below.

---

## 4. Setting up cloud sync (optional)

You need a free Firebase project. It takes about five minutes and costs nothing
at this scale.

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Add project** → give it any name → you can turn Google Analytics off.
3. In the left menu choose **Build → Realtime Database** → **Create Database**.
4. Pick any location. When it asks about security rules, choose **Start in
   locked mode** — you will replace the rules in the next step anyway.
5. Open the **Rules** tab and paste this, then **Publish**:

   ```json
   {
     "rules": {
       "mynotes": {
         "$key": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```

6. Copy the database URL shown at the top of the Data tab. It looks like
   `https://your-project-default-rtdb.firebaseio.com`.
7. In the app: **Transfer & Sync → Cloud**, and fill in:
   - **Database URL** — the URL from step 6
   - **Sync name** — any word you invent, e.g. `my-notes-2024`
   - **Passphrase** — something only you know

Use the **same three values on every phone**. Then **Upload** from the phone that
has your notes, and **Download** on the other one.

### What those rules mean
They let anyone who knows your database URL *and* your sync name read and write
that one spot. That is why the app encrypts everything before uploading: even
with both, all they get is unreadable ciphertext without your passphrase.

Choose a sync name that is not guessable, and a real passphrase.

**If you lose the passphrase, the synced copy cannot be recovered.** There is no
reset — that is the point of it being private. Keep a backup file somewhere safe.

---

## 5. What's in the app

**Writing**
- Rich text: bold, italic, underline, strikethrough, headings, colours, highlight
- Bulleted lists, numbered lists, and checklists you tick off
- Tables, code blocks, quotes, dividers, links
- Font, text size and alignment per selection
- Images and file attachments, pasted or picked
- Freehand sketching with your finger or a stylus
- Dictation (speech → text) and read-aloud (text → speech)
- Undo / redo, clear formatting

**Organising**
- Notebooks with their own colour and icon
- Tags
- Pin notes to the top
- Search across every note
- Reminders with phone notifications
- Trash with restore, and a version history per note
- Links from one note to another
- Starter templates: to-do, meeting notes, journal, idea, shopping list

**Making it yours**
- Dark, light, or match-your-device themes
- Eight accent colours
- Note font, text size and line spacing
- List view or grid view
- Six sort orders, with optional date grouping
- Toggles for spell check, auto-titling, and delete confirmation
- Choose how long the trash keeps things

**Exporting a single note**
Backup file, plain text, an HTML file, straight to the clipboard, or print /
save as PDF.

---

## 6. Where your notes actually live

In your browser's own storage on that device (IndexedDB), inside the app's
sandbox. Nothing leaves the device unless you export it or turn on cloud sync.

That also means: **if you delete the browser's site data, or delete the app and
clear its storage, the notes go with it.** Export a backup file now and then.

Settings and cloud details are kept in `localStorage`. The passphrase is stored
on the device so you don't retype it — clear it with **Forget these sync
details**.

---

## 7. Keyboard shortcuts

| Shortcut | Does |
|---|---|
| `Ctrl/⌘ + B` / `I` / `U` | Bold / italic / underline |
| `Ctrl/⌘ + K` | Insert a link |
| `Ctrl/⌘ + Enter` | Checklist item |
| `Ctrl/⌘ + N` | New note |
| `Ctrl/⌘ + F` | Search |
| `Tab` / `Shift+Tab` | Indent / outdent a list item |
| `Esc` | Close a panel |

---

## 8. Running or changing it locally

```bash
cd notes-app
npm run serve        # http://localhost:8080
```

`localhost` counts as secure, so installing and offline mode work there too.

```bash
npm install          # once, for the tests
npm test             # 33 end-to-end checks in a real browser
npm run shots        # writes screenshots to /tmp
```

### Layout
```
notes-app/
  index.html          app shell
  css/app.css         all styling and theming
  js/db.js            IndexedDB storage + settings
  js/editor.js        the writing surface and toolbar
  js/transfer.js      backup / QR / code / cloud sync + encryption
  js/app.js           state, rendering, every panel
  js/vendor/          QR encoder and scanner
  sw.js               offline service worker
  icons/              app icons
  tests/e2e.mjs       browser test suite
```

No build step and no framework — the files you edit are the files that run.

---

## Known limits

- **iPhone notifications** need iOS 16.4+ and the app added to the Home Screen;
  they are less dependable than a real App Store app. Android is fine.
- **Dictation and read-aloud** use the browser's own speech engines. Chrome
  handles both well; Safari's dictation support is patchier.
- **QR and paste-code transfers skip images and attachments** by design. Use a
  backup file or cloud sync when you need those.
- **Attachments are capped at 12 MB each** to keep browser storage healthy.
