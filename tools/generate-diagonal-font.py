"""The Round 2's rim lettering on its octagon's diagonals: Departure Mono turned 45 degrees, as pixels.

    python3 tools/generate-diagonal-font.py

writes data/departure-font-diagonal.json: each character's pixels, turned clockwise (read down to the right; the
renderer turns them a quarter back, (x, y) -> (y, -x), for lettering read up to the right), about the glyph's
middle. tools/generate-native-font.mjs packs them into font.bin.

A glyph is not turned as an image (its pixels' middles land between pixels, and thresholding them breaks the
strokes or clumps them) but as strokes: it is split into its straight runs (across, down and both diagonals, two
pixels or more; a pixel in none stands alone), each run's ends are turned and rounded, and a line drawn between
them, one pixel wide. Where two strokes meet in a 2x2 block, the pixel with the fewest neighbours goes. Then a few
letters are touched up by eye (FIXES), where the strokes' meeting reads badly at this size.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ °-%"
# Touched up by eye, on the turned glyph: pixels taken out, pixels put in, or a glyph drawn whole.
FIXES = {
    # W: the strokes' meeting closed a loop at its foot, with a hook; the V's points instead
    "W": {"drop": [(-1, 2), (0, 2), (-2, 0), (-2, 1)], "add": [(-2, 0), (0, 2)]},
    # %: the slash across, a ring above it and one below, where % turned puts them
    "%": {"whole": [(x, 0) for x in range(-3, 4)] + [(1, -4), (0, -3), (2, -3), (1, -2)] +
          [(-1, 2), (-2, 3), (0, 3), (-1, 4)]},
}


def pixels(g):
    return {(g["l"] + x + i, y - g["t"]) for x, y, n in g["r"] for i in range(n)}


def runs(px):
    segs, covered = [], set()
    for d in ((1, 0), (0, 1), (1, 1), (1, -1)):
        for p in px:
            if (p[0] - d[0], p[1] - d[1]) in px:
                continue                      # not a run's start
            e, n = p, 1
            while (e[0] + d[0], e[1] + d[1]) in px:
                e, n = (e[0] + d[0], e[1] + d[1]), n + 1
            if n < 2:
                continue
            # a diagonal pair at the corner of two straight strokes is the corner, not a stroke
            if d[0] and d[1] and n == 2 and ((p[0] + d[0], p[1]) in px or (p[0], p[1] + d[1]) in px):
                continue
            segs.append((p, e))
            covered |= {(p[0] + d[0] * k, p[1] + d[1] * k) for k in range(n)}
    return segs + [(p, p) for p in px - covered]


def line(a, b):
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err, out = dx + dy, []
    while True:
        out.append((x0, y0))
        if (x0, y0) == (x1, y1):
            return out
        e2 = 2 * err
        if e2 >= dy:
            err, x0 = err + dy, x0 + sx
        if e2 <= dx:
            err, y0 = err + dx, y0 + sy


def turned(g):
    cx, cy, ca = g["a"] / 2 - 0.5, -3.0, math.cos(math.pi / 4)

    def rot(p):
        x, y = p[0] - cx, p[1] - cy
        return (math.floor((x - y) * ca + 0.5), math.floor((x + y) * ca + 0.5))
    out = set()
    for a, b in runs(pixels(g)):
        out |= set(line(rot(a), rot(b)))
    return out


def unclump(on):
    on = set(on)

    def degree(p):
        return sum((p[0] + dx, p[1] + dy) in on for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy)
    for x, y in sorted(on):
        block = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)]
        if all(p in on for p in block):
            on.discard(min(block, key=degree))
    return on


def glyph(c, font):
    fix = FIXES.get(c, {})
    if "whole" in fix:
        return set(fix["whole"])
    return (unclump(turned(font[c])) - set(fix.get("drop", []))) | set(fix.get("add", []))


def main():
    font = json.loads((ROOT / "data" / "departure-font.json").read_text())["regular"]
    out = {c: sorted(glyph(c, font)) for c in CHARS}
    for c, px in out.items():
        assert all(-8 <= x < 8 and -8 <= y < 8 for x, y in px), c   # each kept as two 4-bit offsets
    text = "{\n" + ",\n".join(f"  {json.dumps(c)}: {json.dumps([list(p) for p in px])}" for c, px in out.items()) + "\n}\n"
    (ROOT / "data" / "departure-font-diagonal.json").write_text(text)
    print(f"data/departure-font-diagonal.json: {len(out)} glyphs, {sum(map(len, out.values()))} pixels")


if __name__ == "__main__":
    main()
