"""Build the single-file site.

    python3 scripts/build.py

Writes index.html (a full page for GitHub Pages) and site/binsight-business.html (the same page without
the document skeleton, for publishing as a claude.ai artifact). Everything is inlined: styles, data and script.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()
css, body, js = read("src", "style.css"), read("src", "page.html"), read("src", "app.js")
data = json.dumps(json.loads(read("data", "demo.json")), separators=(",", ":")).replace("</", "<\\/")

TITLE = "BinSight"
DESC = ("BinSight forecasts how full every communal bin will be tomorrow and plans the rounds overnight. "
        "No upfront cost: councils pay a share of verified savings.")
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800'
         '&family=IBM+Plex+Mono:wght@500;600&family=Public+Sans:ital,wght@0,400..700;1,400&display=swap">')
inner = (f'{FONTS}\n<style>\n{css}\n</style>\n{body}\n'
         f'<script type="application/json" id="demo">{data}</script>\n<script>\n{js}\n</script>\n')

page = (f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        f'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        f'<title>{TITLE}</title>\n<meta name="description" content="{DESC}">\n'
        f'<meta name="theme-color" content="#f3f6f2">\n'
        f'<meta property="og:title" content="BinSight: pay only from what you save">\n<meta property="og:description" content="{DESC}">\n'
        f'</head>\n<body>\n{inner}</body>\n</html>\n')
artifact = (f'<title>{TITLE}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            f'<meta name="description" content="{DESC}">\n{inner}')
open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(page)
os.makedirs(os.path.join(ROOT, "site"), exist_ok=True)
open(os.path.join(ROOT, "site", "binsight-business.html"), "w", encoding="utf-8").write(artifact)
print(f"index.html {len(page) / 1e3:.0f} kB · site/binsight-business.html {len(artifact) / 1e3:.0f} kB")
