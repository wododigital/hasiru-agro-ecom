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
