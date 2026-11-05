#!/usr/bin/env python3
"""Builds desktop/web/ from app/focus-md.html, the one source of the app.

Unlike the web version it bundles its fonts, so the desktop app makes no network
requests of its own. Fonts are fetched once into src/fonts/ (SIL Open Font License).

  python3 desktop/build.py
"""
import re, shutil, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app" / "focus-md.html"
WEB = HERE / "web"
FONTS = HERE / "src" / "fonts"
FONT_CSS = FONTS / "fonts.css"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# Words that only make sense in a browser.
COPY = [
    ("A private, local-first Markdown editor. Everything stays in your browser.", "A private, local-first Markdown editor. Everything stays on your computer."),
    ("| Export | \\`Ctrl+S\\` |", "| Save | \\`Ctrl+S\\` |"),
    ("stays in your browser</span>", "stays on your computer</span>"),
    ("This browser can't save right now (storage is full or blocked). Export this document to keep it.", "Focus.MD can't keep its history right now (storage is full). Save this document to keep it."),
    ("Can't save in this browser. Export this document (Ctrl+S) to keep it.", "Focus.MD's history is full. Save this document (Ctrl+S) to keep it."),
    ("This document couldn't be saved in this browser. ${action} anyway and lose your changes? Export it first to keep it.", "This document couldn't be kept in Focus.MD's history. ${action} anyway and lose your changes? Save it first to keep it."),
]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def bundle_fonts(url):
    if FONT_CSS.exists():
        return
    css = fetch(url).decode()
    keep = []
    for block in re.split(r"(?=/\* [a-z-]+ \*/)", css):
        if not block.startswith(("/* latin */", "/* latin-ext */")):
            continue
        for src in re.findall(r"https://fonts\.gstatic\.com/[^)\s]+", block):
            name = src.rsplit("/", 1)[1]
            if not (FONTS / name).exists():
                (FONTS / name).write_bytes(fetch(src))
            block = block.replace(src, "fonts/" + name)
        keep.append(block)
    FONT_CSS.write_text("".join(keep), encoding="utf-8")

def main():
    html = APP.read_text(encoding="utf-8")
    m = re.search(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\s*<link href="([^"]+)" rel="stylesheet"[^>]*>', html)
    assert m, "Google Fonts links not found"
    bundle_fonts(m.group(1).replace("&amp;", "&"))
    page = html[:m.start()] + '<link rel="stylesheet" href="fonts/fonts.css">' + html[m.end():]
    for old, new in COPY:
        assert old in page, old
        page = page.replace(old, new)
    i = page.rindex("</body>")
    page = page[:i] + '<script src="desktop.js"></script>\n' + page[i:]

    if WEB.exists():
        shutil.rmtree(WEB)
    (WEB / "fonts").mkdir(parents=True)
    (WEB / "index.html").write_text(page, encoding="utf-8")
    shutil.copy(HERE / "src" / "desktop.js", WEB / "desktop.js")
    for f in FONTS.iterdir():
        shutil.copy(f, WEB / "fonts" / f.name)
    size = sum(f.stat().st_size for f in WEB.rglob("*") if f.is_file()) // 1024
    print(f"desktop/web ready, {size} KB")

if __name__ == "__main__":
    main()
