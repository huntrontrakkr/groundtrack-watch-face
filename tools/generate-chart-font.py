"""Whole-pixel hour numerals for Study 05 from Fira Sans Medium (SIL OFL 1.1).

Each glyph is rendered with antialiasing, then kept where coverage is at least
half a pixel. That is the closest whole-pixel shape to the outline; it avoids
the thin, uneven stems of FreeType's monochrome mode at these sizes.
Requires Pillow; the committed masks are enough to run/build the study.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
SIZES = [72, 80, 104]
sizes = {}
for size in SIZES:
    font = ImageFont.truetype(str(root / 'assets/fonts/FiraSans-Medium.ttf'), size)
    glyphs = {}
    for char in '0123456789':
        left, top, right, bottom = font.getbbox(char)
        image = Image.new('L', (right - left + 4, bottom - top + 4), 0)
        ImageDraw.Draw(image).text((2 - left, 2 - top), char, font=font, fill=255)
        image = image.point(lambda v: 255 if v >= 128 else 0)
        image = image.crop(image.getbbox())
        glyphs[char] = {
            'width': image.width, 'height': image.height,
            'rows': [''.join('#' if image.getpixel((x, y)) else '.'
                             for x in range(image.width)) for y in range(image.height)]
        }
    sizes[str(size)] = glyphs
(root / 'data/chart-font.json').write_text(json.dumps({
    'name': 'Fira Sans Medium', 'license': 'SIL OFL 1.1', 'sizes': sizes
}, separators=(',', ':')) + '\n')
print(f'Generated hour numerals at {", ".join(map(str, SIZES))} px.')
