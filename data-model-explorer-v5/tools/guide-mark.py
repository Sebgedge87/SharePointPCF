# Draws a red box and a numbered red badge round each recorded target. python3 mark.py raw/ out/
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
boxes = json.load(open(os.path.join(src, 'boxes.json')))
RED = (217, 45, 32); W = 4; PAD = 6; R = 15
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
for name, bs in boxes.items():
    im = Image.open(os.path.join(src, name + '.png')).convert('RGB'); d = ImageDraw.Draw(im); w, h = im.size
    for i, (x, y, bw, bh) in enumerate(bs, 1):
        x0, y0, x1, y1 = max(2, x - PAD), max(2, y - PAD), min(w - 3, x + bw + PAD), min(h - 3, y + bh + PAD)
        d.rounded_rectangle([x0, y0, x1, y1], radius=8, outline=RED, width=W)
        if len(bs) > 1:   # numbered when there is more than one step
            cx, cy = x0, y0
            cx = min(max(cx, R + 2), w - R - 2); cy = min(max(cy, R + 2), h - R - 2)
            d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=RED, outline=(255, 255, 255), width=2)
            d.text((cx, cy), str(i), font=font, fill=(255, 255, 255), anchor='mm')
    im.save(os.path.join(dst, name + '.png'), optimize=True)
print('marked', len(boxes))
