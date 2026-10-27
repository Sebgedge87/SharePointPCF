#!/usr/bin/env python3
"""Draws the tool's XrmToolBox icons (32 x 32 and 80 x 80) and writes them into Icons.cs.  python3 make-icons.py"""
import base64, io, pathlib
from PIL import Image, ImageDraw

def icon(n):
    W = n * 4; im = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    blue, pink, lw = (10, 72, 115, 255), (187, 28, 115, 255), max(2, W // 22)
    d.line([(0.26 * W, 0.40 * W), (0.40 * W, 0.60 * W)], fill=blue, width=lw)
    d.line([(0.74 * W, 0.40 * W), (0.60 * W, 0.60 * W)], fill=blue, width=lw)
    for i, (x0, y0, x1, y1) in enumerate([(0.06, 0.10, 0.46, 0.40), (0.54, 0.10, 0.94, 0.40), (0.30, 0.60, 0.70, 0.90)]):
        c = pink if i == 2 else blue
        d.rounded_rectangle([x0 * W, y0 * W, x1 * W, y1 * W], radius=W * 0.05, fill=(255, 255, 255, 255), outline=c, width=lw)
        d.rectangle([x0 * W + lw, y0 * W + lw, x1 * W - lw, y0 * W + (y1 - y0) * W * 0.38], fill=c)
    b = io.BytesIO(); im.resize((n, n), Image.LANCZOS).save(b, 'PNG', optimize=True)
    return base64.b64encode(b.getvalue()).decode()

out = pathlib.Path(__file__).with_name('Icons.cs')
out.write_text(f'''namespace FormusPro.DataModelExplorer
{{
    // The tool's icons in XrmToolBox (32 x 32 and 80 x 80 PNG). Made by xrmtoolbox/make-icons.py.
    internal static class Icons
    {{
        public const string Small = "{icon(32)}";
        public const string Big = "{icon(80)}";
    }}
}}
''')
print('wrote', out)
