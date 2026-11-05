"""Builds the Valve logo masters: symbol cuts, colour versions, outlined wordmark and lockups.

Run: python3 brand/source/build.py  (needs fontTools; the wordmark is DejaVu Sans Bold, outlined, so no font ships).
"""
import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = os.path.join(os.path.dirname(__file__), "..", "logo")
FONT_DIR = os.path.expanduser("~/Library/Python/3.12/lib/python/site-packages/matplotlib/mpl-data/fonts/ttf")
INK, ORANGE, PAPER, NIGHT = "#1A1A19", "#C8501C", "#FCFCFB", "#D82222"

def valve(ring_out=100, ring_in=72, lever=14, gap=8, pivot=30, reach=114):
    """The symbol on a 256 grid: a ring (the through-hull) and a lever from the centre, 45 degrees open.
    The ring is cut where the lever crosses it, `gap` wide on each side, so the lever reads as on top."""
    cx = cy = 128
    band = lever + gap
    xo = cx + math.sqrt(ring_out**2 - band**2); xi = cx + math.sqrt(ring_in**2 - band**2)
    ring = (f"M{xo:.2f} {cy-band}A{ring_out} {ring_out} 0 1 0 {xo:.2f} {cy+band}"
            f"L{xi:.2f} {cy+band}A{ring_in} {ring_in} 0 1 1 {xi:.2f} {cy-band}Z")
    end = cx + reach - lever
    arm = f"M{cx} {cy-lever}H{end}A{lever} {lever} 0 0 1 {end} {cy+lever}H{cx}Z"
    dot = f"M{cx-pivot} {cy}A{pivot} {pivot} 0 1 0 {cx+pivot} {cy}A{pivot} {pivot} 0 1 0 {cx-pivot} {cy}Z"
    return ring, arm, dot

# Master, a heavier cut for 16 to 24 px, and a slightly thinner cut for light-on-dark (ink spreads less, light glows more).
CUTS = {
    "": dict(),
    "-small": dict(ring_out=104, ring_in=68, lever=18, gap=11, pivot=34, reach=110),
    "-reversed": dict(ring_in=73.5, lever=13.25, pivot=29),
}

def symbol_group(cut, ring_fill, lever_fill):
    ring, arm, dot = valve(**CUTS[cut])
    # Optical centre: the mass sits low-left (ring) against the lever's upper-right reach; a 1-unit lift balances it.
    return (f'<g transform="translate(0 -1) rotate(-45 128 128)">'
            f'<path fill="{ring_fill}" fill-rule="evenodd" d="{ring}"/>'
            f'<path fill="{lever_fill}" d="{arm}"/><path fill="{lever_fill}" d="{dot}"/></g>')  # separate paths: opposite windings would cut a hole

def svg(w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-labelledby="title">'
            f'<title id="title">{title}</title>{body}</svg>\n')

def text_path(font_file, text, size, x, y, tracking=0.0):
    """Outlined text: one path, baseline at y, `tracking` in em."""
    font = TTFont(os.path.join(FONT_DIR, font_file))
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    hmtx, kern = font["hmtx"], None
    scale = size / upm
    pen = SVGPathPen(gs)
    pos = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x + pos * scale, y)))
        pos += hmtx[name][0] + tracking * upm
    return pen.getCommands(), (pos - tracking * upm) * scale

def lockups(colours, suffix):
    ring_fill, lever_fill, word, sub = colours
    name, w_name = text_path("DejaVuSans-Bold.ttf", "MikroTik Data Meter", 84, 0, 0, tracking=-0.02)
    tag, w_tag = text_path("DejaVuSans.ttf", "for Signal K", 40, 0, 0, tracking=0.01)
    sym = symbol_group("", ring_fill, lever_fill)
    # Horizontal: symbol 256 high; wordmark cap height aligned to the ring's optical middle, gap = one lever width x2.
    x0 = 256 + 56
    w = int(x0 + max(w_name, w_tag) + 8)
    body = (sym + f'<g transform="translate({x0} 132)"><path fill="{word}" d="{name}"/></g>'
            f'<g transform="translate({x0 + 3} 194)"><path fill="{sub}" d="{tag}"/></g>')
    write(f"data-meter-horizontal{suffix}.svg", svg(w, 256, "MikroTik Data Meter logo", body))
    # Stacked: symbol above, centred wordmark and tagline.
    W = int(max(w_name, w_tag) + 16)
    sx = (W - 256) / 2
    body = (f'<g transform="translate({sx:.1f} 0)">{sym}</g>'
            f'<g transform="translate({(W - w_name) / 2:.1f} 352)"><path fill="{word}" d="{name}"/></g>'
            f'<g transform="translate({(W - w_tag) / 2:.1f} 412)"><path fill="{sub}" d="{tag}"/></g>')
    write(f"data-meter-stacked{suffix}.svg", svg(W, 436, "MikroTik Data Meter logo", body))
    write(f"data-meter-wordmark{suffix}.svg",
          svg(int(w_name + 8), 100, "MikroTik Data Meter wordmark", f'<g transform="translate(4 82)"><path fill="{word}" d="{name}"/></g>'))

def write(name, text):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w") as f:
        f.write(text)

if __name__ == "__main__":
    write("valve-symbol.svg", svg(256, 256, "MikroTik Data Meter symbol", symbol_group("", INK, ORANGE)))
    write("valve-symbol-black.svg", svg(256, 256, "MikroTik Data Meter symbol", symbol_group("", "#000000", "#000000")))
    write("valve-symbol-small.svg", svg(256, 256, "MikroTik Data Meter symbol, small sizes", symbol_group("-small", INK, ORANGE)))
    write("valve-symbol-small-black.svg", svg(256, 256, "MikroTik Data Meter symbol, small sizes", symbol_group("-small", "#000000", "#000000")))
    write("valve-symbol-reversed.svg", svg(256, 256, "MikroTik Data Meter symbol on dark", symbol_group("-reversed", PAPER, ORANGE)))
    write("valve-symbol-night.svg", svg(256, 256, "MikroTik Data Meter symbol, night", symbol_group("-reversed", NIGHT, NIGHT)))
    lockups((INK, ORANGE, INK, "#52514E"), "")
    lockups(("#000000", "#000000", "#000000", "#000000"), "-black")
    lockups((PAPER, ORANGE, PAPER, "#C3C2B7"), "-reversed")
    print("wrote", sorted(os.listdir(OUT)))
