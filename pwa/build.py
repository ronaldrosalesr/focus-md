#!/usr/bin/env python3
"""Builds the installable Focus.MD into pwa/dist/ from app/focus-md.html.

The single-file app stays the one source of truth, so the download and the PWA
can't drift apart. Upload everything in dist/ to the same folder on an HTTPS host.

  python3 pwa/build.py
"""
import hashlib, json, re, shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app" / "focus-md.html"
DIST = HERE / "dist"

MANIFEST = {
    "name": "Focus.MD",
    "short_name": "Focus.MD",
    "description": "A private, local-first Markdown editor. Everything stays on your device.",
    "id": "./",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#ffffff",
    "theme_color": "#ffffff",
    "lang": "en",
    "categories": ["productivity", "utilities"],
    "icons": [
        {"src": f"icons/icon-{s}.png", "sizes": f"{s}x{s}", "type": "image/png", "purpose": "any"} for s in (192, 512)
    ] + [
        {"src": f"icons/maskable-{s}.png", "sizes": f"{s}x{s}", "type": "image/png", "purpose": "maskable"} for s in (192, 512)
    ],
    "file_handlers": [
        {"action": "./", "accept": {"text/markdown": [".md", ".markdown"], "text/plain": [".txt"]}}
    ],
    "launch_handler": {"client_mode": "focus-existing"},
}

HEAD = """<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#ffffff">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Focus.MD">
<meta name="application-name" content="Focus.MD">
<meta name="description" content="A private, local-first Markdown editor. Everything stays on your device.">
"""

def main():
    html = APP.read_text(encoding="utf-8")
    assert html.count("</head>") == 1 and html.rstrip().endswith("</html>")
    font_css = re.search(r'<link href="(https://fonts\.googleapis\.com/css2[^"]+)"', html).group(1).replace("&amp;", "&")
    version = re.search(r'<meta name="version" content="([^"]+)"', html).group(1)

    pwa_js = (HERE / "src" / "pwa.js").read_text(encoding="utf-8")
    page = html.replace("</head>", HEAD + "</head>", 1)
    i = page.rindex("</body>")
    page = page[:i] + "<script>\n" + pwa_js + "</script>\n" + page[i:]

    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "icons").mkdir(parents=True)
    (DIST / "index.html").write_text(page, encoding="utf-8")
    (DIST / "manifest.webmanifest").write_text(json.dumps(MANIFEST, indent=2) + "\n", encoding="utf-8")
    for icon in (HERE / "src" / "icons").glob("*.png"):
        shutil.copy(icon, DIST / "icons" / icon.name)

    # A new cache name for every change, so an update replaces the old copy.
    stamp = hashlib.sha256((page + (HERE / "src" / "sw.js").read_text(encoding="utf-8")).encode()).hexdigest()[:10]
    sw = (HERE / "src" / "sw.js").read_text(encoding="utf-8").replace("__BUILD__", f"{version}-{stamp}").replace("__FONT_CSS__", font_css)
    (DIST / "sw.js").write_text(sw, encoding="utf-8")
    print(f"Focus.MD {version} ({stamp}) -> {DIST}")
    for f in sorted(DIST.rglob("*")):
        if f.is_file():
            print(f"  {f.relative_to(DIST)}  {f.stat().st_size // 1024} KB")

if __name__ == "__main__":
    main()
