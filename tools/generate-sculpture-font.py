"""Whole-pixel numeral masks from Fira Sans Medium (SIL OFL 1.1).

This is a licensed typeface, not a reproduction of any watchmaker's numerals.
Requires Pillow; the committed masks are enough to run/build the study.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
font = ImageFont.truetype(str(root / 'assets/fonts/FiraSans-Medium.ttf'), 54)
glyphs = {}
for char in '0123456789':
    bounds = font.getbbox(char)
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    bitmap = Image.new('1', (width, height))
    ImageDraw.Draw(bitmap).text((-bounds[0], -bounds[1]), char, font=font, fill=1)
    # Trim optical side bearings; spacing between numerals is explicit below.
    bitmap = bitmap.crop(bitmap.getbbox())
    glyphs[char] = {
        'width': bitmap.width, 'height': bitmap.height,
        'rows': [''.join('#' if bitmap.getpixel((x, y)) else '.'
                         for x in range(bitmap.width)) for y in range(bitmap.height)]
    }
minute_font = ImageFont.truetype(str(root / 'assets/fonts/FiraSans-Medium.ttf'), 13)
minute_glyphs = {}
for char in '0123456789':
    bounds = minute_font.getbbox(char)
    bitmap = Image.new('1', (bounds[2] - bounds[0], bounds[3] - bounds[1]))
    ImageDraw.Draw(bitmap).text((-bounds[0], -bounds[1]), char, font=minute_font, fill=1)
    minute_glyphs[char] = {
        'width': bitmap.width, 'height': bitmap.height,
        'rows': [''.join('#' if bitmap.getpixel((x, y)) else '.'
                         for x in range(bitmap.width)) for y in range(bitmap.height)]
    }
(root / 'data/sculpture-font.json').write_text(json.dumps({
    'name': 'Fira Sans Medium', 'sourceSize': 54, 'license': 'SIL OFL 1.1',
    'gap': 5, 'glyphs': glyphs, 'minuteGlyphs': minute_glyphs
}, separators=(',', ':')) + '\n')
print('Generated hour and minute numeral masks.')
