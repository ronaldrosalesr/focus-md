# Focus.MD desktop (Tauri)

The Mac and Windows app. `build.py` generates `web/` from `../app/focus-md.html`, so the app has one source. It adds `src/desktop.js` and bundles the fonts, so it makes no font requests.

```bash
npm install
npm run dev     # run it
npm run build   # build the app and installer
```

Needs Rust (rustup.rs). On a Mac, `CI=true npm run build` skips the Finder step that arranges the `.dmg` window, which fails without Automation permission.

## What it adds to the web app
- Open: double-click a `.md` file, or Open / Cmd+O. Save As makes a new file.
- Autosave: a document tied to a file writes to it shortly after typing stops, and closing or quitting finishes any pending write first. A document with no file autosaves to the app's history until its first Save.
- If the app has no record of permission for a file (or a write fails), it asks: Save to This File, Save a Copy, or Cancel.
- Line endings and BOM come back as they were on opening. Non-UTF-8 files are refused, not guessed at.
- If the file changed outside the app, autosave stops, the badge says File changed, and Save asks before replacing it. Autosave never replaces outside changes.
- Links open in the default browser.

## Security
File access lives in `src-tauri/src/main.rs`. The window can only read or write files the person chose in a dialog or opened from the system (`allowed-files.json` in app data). It has only `core:default` permissions.

## Windows
A Windows installer has to be built on Windows: run the "Focus.MD Windows" workflow in GitHub Actions (`.github/workflows/windows.yml`). It builds an unsigned installer.

## Testing status
On Mac (Apple Silicon), a manual run on the Safari engine typed new blocks and saved to a Windows-line-ending file with every original line intact. Automatic saving's page logic was tested with a simulated file layer, but needs a real run. The Windows installer builds in GitHub Actions but hasn't been run on Windows yet.
