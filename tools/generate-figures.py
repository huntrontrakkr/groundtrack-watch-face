"""Whole-pixel figure sets for the hour figures, the time callout and the
tape: data/figures.json, packed into the watch's figures.bin by
tools/generate-native-data.mjs. (Figures drawn as contour lines, a dot
lattice, seven segments, and Jost as letterpress, halftone, engraving and
stencil were tried and dropped.)

Each set is sized by its digit height in display pixels (as Jost, the
first, always was), its widths held near Jost's so it fits the same
layouts. Each is a font, rasterised with antialiasing and kept where
coverage is at least half a pixel:

  jost      Jost 600 (SIL OFL 1.1), a revival of Futura: the face of the
            Apollo 11 plaque and many mission patches.
  b612      B612 Bold (SIL OFL 1.1), drawn for Airbus cockpit displays.
  michroma  Michroma (SIL OFL 1.1), after Microgramma and Eurostile: the
            lettering of 2001's Discovery and of NASA's hardware; its one
            light weight made bold by thickening its strokes.
  orbitron  Orbitron Black (SIL OFL 1.1), a geometric face of the space age.

Run with Pillow: uv run --with pillow python tools/generate-figures.py
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

root = Path(__file__).resolve().parent.parent
fonts = root / 'assets/fonts'
# Callout minutes and hours; the scale panel (ISS); two-digit and
# single-digit hours on the chart.
HEIGHTS = {'20': 17, '28': 24, '40': 34, '72': 49, '80': 55}
DIGITS = '0123456789'
# A set's widest figure may be this much wider than Jost's at that size.
WIDTH_ALLOWANCE = 1.15


def truetype(path, size, weight=None, bold=0):
    f = ImageFont.truetype(str(path), size)
    if weight is not None:
        f.set_variation_by_axes([weight])
    f.bold = bold(size) if callable(bold) else bold
    return f


def mask(f, char):
    left, top, right, bottom = f.getbbox(char)
    image = Image.new('L', (right - left + 8, bottom - top + 8), 0)
    ImageDraw.Draw(image).text((4 - left, 4 - top), char, font=f, fill=255)
    image = image.point(lambda v: 255 if v >= 128 else 0)
    # A face with only a light weight, made bold: its strokes thickened by
    # `bold` pixels.
    for _ in range(getattr(f, 'bold', 0)):
        image = image.filter(ImageFilter.MaxFilter(3))
    return image.crop(image.getbbox())


def sized(make, height, max_width=None):
    """The smallest font size whose '0' reaches the height, then smaller
    while its widest figure is wider than max_width."""
    size = height
    while mask(make(size), '0').height < height:
        size += 1
    if max_width:
        while size > 6 and max(mask(make(size), c).width for c in DIGITS) > max_width:
            size -= 1
    return make(size)


def glyph(image):
    return {'width': image.width, 'height': image.height,
            'rows': [''.join('#' if image.getpixel((x, y)) else '.' for x in range(image.width))
                     for y in range(image.height)]}


def font_set(make, widths=None):
    sizes = {}
    for key, height in HEIGHTS.items():
        f = sized(make, height, widths and round(widths[key] * WIDTH_ALLOWANCE))
        sizes[key] = {c: glyph(mask(f, c)) for c in DIGITS}
    return sizes


def jost(weight):
    return lambda size: truetype(fonts / 'Jost-Variable.ttf', size, weight)


jost_sizes = font_set(jost(600))
widths = {key: max(g['width'] for g in jost_sizes[key].values()) for key in HEIGHTS}
SETS = [
    ('jost', 'Jost', 'Futura revival: the Apollo 11 plaque', 'SIL OFL 1.1', jost_sizes),
    ('b612', 'B612', 'Airbus cockpit displays', 'SIL OFL 1.1',
     font_set(lambda size: truetype(fonts / 'B612-Bold.ttf', size), widths)),
    ('michroma', 'Michroma', 'Eurostile: 2001 and NASA hardware', 'SIL OFL 1.1',
     font_set(lambda size: truetype(fonts / 'Michroma-Regular.ttf', size, bold=lambda s: 1 if s < 40 else 2), widths)),
    ('orbitron', 'Orbitron', 'Space-age geometric', 'SIL OFL 1.1',
     font_set(lambda size: truetype(fonts / 'Orbitron-Variable.ttf', size, 900), widths)),
]
(root / 'data/figures.json').write_text(json.dumps(
    {'sets': [{'key': k, 'name': n, 'note': note, 'license': lic, 'sizes': sizes} for k, n, note, lic, sizes in SETS]},
    separators=(',', ':')) + '\n')
for k, n, note, lic, sizes in SETS:
    print(f'{n:9} ' + '  '.join(f'{key}px: {max(g["width"] for g in sizes[key].values())}x{max(g["height"] for g in sizes[key].values())}' for key in HEIGHTS))
