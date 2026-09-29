"""Whole-pixel glyphs from Departure Mono (Helena Zhang, SIL OFL 1.1).

Departure Mono is drawn on an 11 px grid, so at 11 px (and exact multiples)
every pixel is fully on or off: no thresholding is needed. Glyphs are stored
as run-length rows in the same shape as data/draft-font.json.
Requires Pillow; the committed data is enough to run/build the studies.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
CHARS = ''.join(chr(c) for c in range(32, 127)) + '°'
out = {}
for scale in (1, 2):
    size = 11 * scale
    font = ImageFont.truetype(str(root / 'assets/fonts/DepartureMono-Regular.otf'), size)
    ascent, _ = font.getmetrics()
    glyphs = {}
    for char in CHARS:
        advance = round(font.getlength(char))
        image = Image.new('L', (advance + 4, size + 8), 0)
        ImageDraw.Draw(image).text((2, 4), char, font=font, fill=255)
        box = image.getbbox()
        runs, left, top = [], 0, 0
        if box:
            left, top = box[0] - 2, 4 + ascent - box[1]
            for y in range(box[1], box[3]):
                x = box[0]
                while x < box[2]:
                    if image.getpixel((x, y)) >= 128:
                        start = x
                        while x < box[2] and image.getpixel((x, y)) >= 128:
                            x += 1
                        runs.append([start - box[0], y - box[1], x - start])
                    else:
                        x += 1
        glyphs[char] = {'a': advance, 'l': left, 't': top, 'r': runs}
    out['regular' if scale == 1 else 'double'] = glyphs
(root / 'data/departure-font.json').write_text(json.dumps(
    {'name': 'Departure Mono 1.500', 'license': 'SIL OFL 1.1', **out}, separators=(',', ':')) + '\n')
print(f'Generated {len(CHARS)} glyphs at 11 and 22 px.')
