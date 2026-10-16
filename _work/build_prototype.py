"""Build hasiru-agro-prototype.html from the template, inlining the catalogue and logo.
Usage: python3 _work/build_prototype.py
"""
import base64, json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
cat = json.loads((root / "_work/catalog.json").read_text())
keep = ["id", "n", "c", "s", "p", "r", "sz", "sp", "ex", "t", "ty", "b", "y", "img", "st", "f"]
cat = [{k: x[k] for k in keep if x.get(k) not in (None, "")} | {"st": x["st"], "f": x["f"]} for x in cat]
logo = "data:image/webp;base64," + base64.b64encode((root / "logo_white_hasiru_agro.webp").read_bytes()).decode()
html = (root / "_work/prototype.template.html").read_text()
html = html.replace("__CATALOG__", json.dumps(cat, ensure_ascii=False, separators=(",", ":"))).replace("__LOGO__", logo)
(root / "hasiru-agro-prototype.html").write_text(html)
print("wrote", len(html) // 1024, "KB")
# Vercel deploys only this folder (root directory "site"), keeping client files out of the public site
(root / "site").mkdir(exist_ok=True)
(root / "site/index.html").write_text(html)
# High-quality 3D test page: the source is artifact-style (no document skeleton), so wrap it for static hosting
hq = (root / "_work/3d-hq-demo.html").read_text()
(root / "site/3d.html").write_text('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + hq + '\n</body>\n</html>\n')
(root / "site/assets").mkdir(exist_ok=True)
(root / "site/assets/mango.glb").write_bytes((root / "_work/assets/mango.glb").read_bytes())
