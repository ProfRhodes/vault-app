"""Renders the app icons from the SVG below with the local Playwright browser.

    python icons/make_icons.py

The design is three memory wheels with linked notes, the same motif as the
graph's wheel view. The maskable version shrinks the art into Android's
safe zone so launchers can crop it to any shape.
"""

from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).parent


def svg(scale, size):
    return f"""
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="45%" r="70%">
      <stop offset="0" stop-color="#1f1833"/>
      <stop offset="1" stop-color="#0b0912"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale({scale})">
    <circle r="200" fill="none" stroke="#5eead4" stroke-opacity="0.55" stroke-width="6"/>
    <circle r="140" fill="none" stroke="#a78bfa" stroke-opacity="0.7" stroke-width="6"/>
    <circle r="80" fill="none" stroke="#e0b84f" stroke-opacity="0.85" stroke-width="6"/>
    <g stroke="#e0b84f" stroke-opacity="0.75" stroke-width="5" fill="none">
      <path d="M0 -80 L121 -70 L173 100 L0 0 Z"/>
      <path d="M0 -80 L-121 -70 L-100 173"/>
    </g>
    <g fill="#e0b84f">
      <circle cy="-80" r="20"/>
      <circle r="16"/>
    </g>
    <g fill="#a78bfa">
      <circle cx="121" cy="-70" r="16"/>
      <circle cx="-121" cy="-70" r="16"/>
    </g>
    <g fill="#5eead4">
      <circle cx="173" cy="100" r="14"/>
      <circle cx="-100" cy="173" r="14"/>
    </g>
    <path d="M-16 -246 L16 -246 L0 -218 Z" fill="#e0b84f"/>
  </g>
</svg>"""


with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, size, scale in [
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("icon-maskable-512.png", 512, 0.78),
    ]:
        page = browser.new_page(viewport={"width": size, "height": size})
        page.set_content(
            f'<html><body style="margin:0"><div style="width:{size}px;height:{size}px">'
            + svg(scale, size)
            + "</div></body></html>"
        )
        page.screenshot(path=str(OUT / name), clip={"x": 0, "y": 0, "width": size, "height": size})
        page.close()
        print("wrote", name)
    browser.close()
