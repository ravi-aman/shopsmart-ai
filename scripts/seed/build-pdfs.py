"""Renders the PDF knowledge documents from scripts/seed/pdf-src/*.md.

Each "## Heading" becomes a PDF outline (bookmark) entry, which Spring AI's ParagraphPdfDocumentReader
uses to split the PDF into sections. Requires reportlab:

    python -m venv .venv && .venv/Scripts/pip install reportlab
    .venv/Scripts/python scripts/seed/build-pdfs.py
"""
import pathlib
import sys

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts" / "seed" / "pdf-src"
OUT = ROOT / "apps" / "backend" / "src" / "main" / "resources" / "seed" / "knowledge"

# file stem -> footer line (version and effective date also live in manifest.json)
VERSIONS = {
    "laptop-return-policy": "Version 2026.1 - Effective 1 January 2026",
    "refund-policy": "Version 2026.1 - Effective 1 January 2026",
    "seller-guidelines": "Version 2025.3 - Effective 1 October 2025",
}


class Bookmarked(Paragraph):
    def __init__(self, text, style, key, level):
        super().__init__(text, style)
        self.key, self.level = key, level

    def draw(self):
        super().draw()
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.plainText if hasattr(self, "plainText") else self.text, self.key, self.level)


def render(md_path: pathlib.Path):
    styles = getSampleStyleSheet()
    story = []
    n = 0
    for raw in md_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        n += 1
        if line.startswith("## "):
            story += [Spacer(1, 8), Bookmarked(line[3:], styles["Heading2"], f"s{n}", 1)]
        elif line.startswith("# "):
            story += [Bookmarked(line[2:], styles["Title"], f"s{n}", 0),
                      Paragraph(VERSIONS.get(md_path.stem, ""), styles["Italic"]), Spacer(1, 10)]
        else:
            story.append(Paragraph(line, styles["BodyText"]))
    out = OUT / f"{md_path.stem}.pdf"
    doc = SimpleDocTemplate(str(out), pagesize=A4, title=md_path.stem.replace("-", " ").title(), author="ShopSmart")
    doc.build(story)
    print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for p in sorted(SRC.glob("*.md")):
        render(p)
    sys.exit(0)
