# Lays each recorded frame into a 1920x1080 video frame: the step guide in a sidebar, the current step on top,
# a tip underneath, and the page itself. python3 compose.py <outdir>  ->  <outdir>/walkthrough.mp4
import json, os, sys, subprocess
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]; tl = json.load(open(os.path.join(out, 'timeline.json')))
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font = lambda s, b=False: ImageFont.truetype(FB if b else F, s)
NAVY, NAVY2, PINK, PALE, WHITE, SOFT, DIM = (10, 72, 115), (6, 26, 70), (187, 28, 115), (236, 241, 245), (255, 255, 255), (201, 220, 234), (120, 150, 180)
W, H, SB, TOP, PW, PH = 1920, 1080, 480, 110, 1440, 860

STEPS = [
  ('Open your workbook', ['Click Open workbook… in the header,', 'or drag the .xlsx onto the page.', 'Metadata exports are converted', 'automatically.'], 'One HTML file in Chrome or Edge. Nothing to install, and nothing is uploaded.'),
  ('Review the Overview', ['Count cards open their lists.', 'Open all checks shows every finding.', 'Build solution… starts the build.'], 'The model at a glance: size, completeness, areas and checks.'),
  ('Fix problems in Checks', ['Filter by Errors, Warnings or Info.', 'Click a finding to open the field.', 'Export (CSV) for a list to share.'], 'Checks update as you edit. Clear the errors before building.'),
  ('Draw the ERD', ['Pick tables, an area, or All.', '★ makes a table the core of the diagram.', 'Export to draw.io, SVG, PNG or Mermaid.'], 'Lines show one or many only where the relationship type is recorded.'),
  ('Edit a table', ['Open a table from the sidebar.', 'Double-click a cell to edit it.', 'Enter saves, Esc cancels.'], 'Primary key and primary name are tagged in the field list and the header.'),
  ('Add a field', ['Click + Add field.', 'Type the display name: the names follow.', 'For a lookup, pick the related table.', 'Click Add.'], 'Lookups get Relationship Type N:1 and their Targets filled in for you.'),
  ('Review your changes', ['Click Changes in the header.', 'Revert one edit, or Revert all.', 'Remove a row you added.'], 'Edits are kept in your browser and carry over to newer versions of the workbook.'),
  ('Save to the workbook', ['Export ▾ → Download an updated copy.', 'Name the file, then Download.', 'Or New version in template format.'], 'Only the cells you changed are rewritten, and the file is checked before saving.'),
  ('Build the solution', ['Export ▾ → Dataverse solution (.zip)…', 'Publisher unique name must match', 'the environment exactly.', 'Check Will be built, then Generate.'], 'Unzip and run import.ps1 against a development environment first.'),
]

def wrap(d, text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def chrome(step, done):
    """the frame around the page for one step: 0 = intro, 10/done = all finished"""
    im = Image.new('RGB', (W, H), WHITE); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, SB, H], fill=NAVY); d.rectangle([0, 0, 10, H], fill=PINK)
    d.text((44, 40), 'Step-by-step guide', font=font(28, True), fill=WHITE)
    d.text((44, 80), 'Data Model Explorer', font=font(18), fill=SOFT)
    y = 132
    for i, (title, lines, _) in enumerate(STEPS, 1):
        cur = i == step; past = done or (step and i < step)
        r = 17; cx, cy = 62, y + 16
        if cur: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PINK)
        elif past: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(46, 120, 168))
        else: d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=DIM, width=2)
        d.text((cx, cy), '✓' if past and not cur else str(i), font=font(17, True), fill=WHITE if (cur or past) else DIM, anchor='mm')
        d.text((94, y + 3), title, font=font(23 if cur else 20, cur), fill=WHITE if cur else (SOFT if past else DIM))
        y += 44
        if cur:
            box_top = y - 4
            for ln in lines:
                for part in wrap(d, ln, font(18), SB - 130):
                    d.text((96, y), part, font=font(18), fill=WHITE); y += 26
                y += 4
            d.rectangle([80, box_top, 84, y - 6], fill=PINK)
            y += 14
    # top band and tip band
    d.rectangle([SB, 0, W, TOP], fill=PALE); d.rectangle([SB, TOP + PH, W, H], fill=PALE)
    if step and not done:
        d.text((SB + 40, 26), f'STEP {step} OF {len(STEPS)}', font=font(18, True), fill=PINK)
        d.text((SB + 40, 52), STEPS[step - 1][0], font=font(36, True), fill=NAVY)
        tip = STEPS[step - 1][2]
        d.text((SB + 40, TOP + PH + 38), tip, font=font(22), fill=NAVY2)
    else:
        d.text((SB + 40, 34), 'Data Model Explorer · walkthrough' if not done else 'Done: from workbook to Dataverse solution', font=font(34, True), fill=NAVY)
        d.text((SB + 40, TOP + PH + 38), 'Full user guide with screenshots: data-model-explorer/docs/User_Guide.md', font=font(22), fill=NAVY2)
    return im

frames, marks, end = tl['frames'], tl['marks'], tl['end']
def state(t):
    s, seen = 0, False
    for m in marks:
        if m['t'] <= t: s = m['step']; seen = seen or s > 0
    return s, (s in (0, 10) and seen)
cache = {}
fd = os.path.join(out, 'comp'); os.makedirs(fd, exist_ok=True)
lst = []
for k, fr in enumerate(frames):
    st = state(fr['t']); key = st
    if key not in cache: cache[key] = chrome(*st)
    im = cache[key].copy(); pg = Image.open(os.path.join(out, 'frames', fr['f'])).convert('RGB')
    if pg.size != (PW, PH): pg = pg.resize((PW, PH))
    im.paste(pg, (SB, TOP)); name = f'c{k:05d}.jpg'; im.save(os.path.join(fd, name), quality=90)
    nxt = frames[k + 1]['t'] if k + 1 < len(frames) else end
    lst.append(f"file '{name}'\nduration {max(0.001, nxt - fr['t']):.3f}")
lst.append(f"file '{name}'")
open(os.path.join(fd, 'list.txt'), 'w').write('\n'.join(lst) + '\n')
mp4 = os.path.join(out, 'walkthrough.mp4')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', os.path.join(fd, 'list.txt'), '-vf', 'fps=30,format=yuv420p',
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', mp4], check=True)
print('video', mp4, len(frames), 'frames', len(cache), 'layouts')
