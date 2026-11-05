# Focus.MD

A private Markdown editor that opens on your document, not on a wall of symbols. Click anywhere and type. Your files stay on your device, with no account and no server in the middle.

I'm Ronald Rosales, a product designer. I built Focus.MD because I kept copying Markdown into other apps just to read it, then copying it back to edit. I made it with [Claude Code](https://claude.com/claude-code): I decide what the product should do and how it should feel, Claude writes most of the code, and I test it by using it.

**[Get Focus.MD](https://ronaldrosales.com/focus-md-app/)**

## What it does

- **Three modes:** Focus shows just your document, Both shows it next to the Markdown, and Markdown shows only the raw text.
- **Two-way editing:** type on either side and the other one follows.
- **History:** your last 20 documents stay in a sidebar you can search.
- **Works offline:** nothing is uploaded or tracked.

## One app, three versions

Everything is generated from one file, `app/focus-md.html`, so the versions can't drift apart.

| Version | Folder | What it is |
|---|---|---|
| Single file | `app/` | A 180 KB HTML file. Double-click it and it opens in your browser. |
| Installable web app (PWA) | `pwa/` | Its own window and offline support. Not published yet. |
| Desktop app for Mac and Windows | `desktop/` | Built with [Tauri](https://tauri.app). It opens your real `.md` files and autosaves to them. The installers are about 3.5 MB on Mac and 1.5 MB on Windows. |

## How the two-way editing works

The easy way to build this is to convert the whole page back to Markdown after every edit, but that rewrites things you never touched. Markdown lets you write the same thing in different ways, and your file should keep the way you wrote it.

So the Markdown stays the source of truth. The app splits it into blocks that remember their exact source text, and an edit only rewrites the blocks you changed. Anything that can't convert back safely, like raw HTML, stays read-only on the document side. Look for `TwoWay` in `app/focus-md.html`.

## How the desktop app handles your files

- Files are read and written by the Rust side in `desktop/src-tauri/src/main.rs`, not by the page.
- The window can only touch files you chose or opened yourself.
- Line endings come back the way they were when you opened the file.
- If a file changed outside the app, autosave stops and asks before replacing it.

## Build it yourself

The single file needs no build. Just open `app/focus-md.html`.

Web app, which needs Python 3:

```bash
python3 pwa/build.py
```

Desktop app, which also needs Node and [Rust](https://rustup.rs):

```bash
cd desktop
npm install
npm run dev
```

`npm run build` makes the app and installer. Windows installers have to be built on Windows, so the workflow in `.github/workflows/windows.yml` builds one on GitHub.

## Status

This is an early project, so some things aren't done yet:

- The desktop apps aren't signed. macOS and Windows show a security warning when you open them.
- The Windows app hasn't been run on a real Windows computer yet.
- Two-way editing has been tested in Chrome, and on the Safari engine in the Mac app. Firefox and phones haven't been tested yet.

## How it was built

I wrote about it on my blog:

- [The Word That Changed Focus.MD](https://ronaldrosales.com/the-word-that-changed-focus-md/)
- [From a Web Page to a Real App](https://ronaldrosales.com/from-a-web-page-to-a-real-app/)

Feedback is very welcome. Open an issue and tell me what feels off.

## License

[MIT](LICENSE). Third-party code and fonts are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
