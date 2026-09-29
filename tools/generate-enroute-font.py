"""Whole-pixel figures for Study 06 from Jost (SIL OFL 1.1), a revival of
Futura: the face of the Apollo 11 plaque and many mission patches.

Each figure set is sized by its digit height in display pixels, rendered with
antialiasing and kept where coverage is at least half a pixel. Keys match the
figure roles in src/enroute-render.js. Requires Pillow; the committed masks
are enough to run/build the study.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
WEIGHT = 600
HEIGHTS = {'40': 34, '72': 49, '80': 55}  # scale panel (ISS); two-digit and single-digit hours on the chart


def font(size):
    f = ImageFont.truetype(str(root / 'assets/fonts/Jost-Variable.ttf'), size)
    f.set_variation_by_axes([WEIGHT])
    return f


def mask(f, char):
    left, top, right, bottom = f.getbbox(char)
    image = Image.new('L', (right - left + 4, bottom - top + 4), 0)
    ImageDraw.Draw(image).text((2 - left, 2 - top), char, font=f, fill=255)
    image = image.point(lambda v: 255 if v >= 128 else 0)
    return image.crop(image.getbbox())


sizes = {}
for key, height in HEIGHTS.items():
    size = height
    while mask(font(size), '0').height < height:
        size += 1
    f = font(size)
    glyphs = {}
    for char in '0123456789':
        image = mask(f, char)
        glyphs[char] = {'width': image.width, 'height': image.height,
                        'rows': [''.join('#' if image.getpixel((x, y)) else '.' for x in range(image.width))
                                 for y in range(image.height)]}
    sizes[key] = glyphs
(root / 'data/enroute-font.json').write_text(json.dumps(
    {'name': f'Jost {WEIGHT}', 'license': 'SIL OFL 1.1', 'sizes': sizes}, separators=(',', ':')) + '\n')
print('Generated Jost figures at', ', '.join(f'{h} px' for h in HEIGHTS.values()))
