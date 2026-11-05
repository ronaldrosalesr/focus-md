# Focus.MD PWA

The installable version of Focus.MD. It's generated from `../app/focus-md.html`, so the app has one source and the single-file download stays exactly as it is.

```bash
python3 focus-md/pwa/build.py
```

That writes `dist/`. Preview it with the `focus-md-pwa` entry in `.claude/launch.json` (port 5192).

## What's here
- `build.py`: copies the app, adds the manifest link, metas and `src/pwa.js`, and stamps a new cache name on the service worker.
- `src/sw.js`: serves the page from the network when it answers within 3 seconds, otherwise from the cache. Everything else is cache first. It never sees documents, which stay in `localStorage`.
- `src/pwa.js`: service worker registration, the Install button, the title bar color, and opening `.md` files from the system.
- `src/icons/`: normal and maskable icons.

## Publishing
Upload everything in `dist/` to one folder on an HTTPS host. `sw.js` must be served from that same folder. Paths are relative, so any folder works.

**Choose the address once.** A browser keeps documents per origin (scheme + domain + port), so moving to another domain or subdomain later leaves people's saved documents behind at the old address. Moving between folders on the same origin keeps them, though installed copies would still need reinstalling.

## Updates
Rebuild and upload. People get the new page on their next launch while online, and the old cached copy is replaced then.

## What works where
| | Chrome / Edge (desktop) | Safari (Mac) | Safari (iPhone) | Firefox (desktop) |
|---|---|---|---|---|
| Works offline | Tested | Not tested | Not tested | Not tested |
| Install | Install button or address bar | File > Add to Dock | Share > Add to Home Screen | No install option |
| Open a `.md` file from the system | Once installed | No | No | No |

Tested in Chrome on Mac only: it reports no installability errors, and offline load, edit and save work with the server stopped. Installing by hand and opening a file from Finder still need a real run, and the `file_handlers` flow has only been exercised through its shared open path.

Saving still means Export. Writing straight back to the opened file is not built.
