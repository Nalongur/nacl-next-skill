"""Rasterize the project's website favicon to a square ICO using Pillow.

The SVG is authoritative; this renderer supports its rect and text elements.
Requires Pillow 11.1.0 and Windows Arial Bold / Segoe UI Symbol fonts.
"""
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[4]
svg = root / 'website/public/favicon.svg'
tree = ET.parse(svg).getroot()
rect, *labels = list(tree)
scale = 16
w = 72 * scale
h = 72 * scale
im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
yoffset = 4 * scale
d.rounded_rectangle((0, yoffset, w-1, yoffset+64*scale-1), radius=10*scale, fill=rect.get('fill'))
for label in labels:
    fontpath = 'C:/Windows/Fonts/arialbd.ttf' if label.text == 'n' else 'C:/Windows/Fonts/seguisym.ttf'
    font = ImageFont.truetype(fontpath, int(label.get('font-size')) * scale)
    d.text((int(label.get('x'))*scale, yoffset+int(label.get('y'))*scale), label.text, font=font, fill=label.get('fill'), anchor='ls')
im = im.resize((256,256), Image.Resampling.LANCZOS)
im.save(Path(__file__).with_name('icon.ico'), format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
