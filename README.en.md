[Français](README.md) · **English**

# Smart Dark Mode

Darkens light pages and **leaves already-dark ones alone**.

## Installation
1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and choose this folder.
3. Reload tabs that are already open (a freshly installed extension is not injected into pages that are already loaded).

## Behavior
| Situation | What the extension does |
|---|---|
| Page already dark | **Nothing.** No filter, the page is strictly identical (tested pixel for pixel). |
| Light page | Page inversion: dark background, light text, hues preserved. |
| Already-dark block inside a light page (code, banner…) | Left as is. |
| Images, videos, canvas, iframes, image backgrounds | Left as is. |
| The site switches to dark by itself (theme button, late load) | The extension steps back. |
| Site already seen as light | Darkened from the first frame, no white flash. |

Detection measures background colors across the whole visible area (25 points), looks at the page body's background and,
if the screen is covered by images, at the text color. The page's own colors are never modified, so the measurement
stays valid while the filter is active.

## Usage
- **Icon**: master switch, page state, "Disable on this site" button. An **ON** badge appears on the icon when the page is darkened.
- **Alt+Shift+D**: toggles dark mode on the current site (changeable in `chrome://extensions/shortcuts`).
- Changes apply live, without reloading the page.

## Known limitations
- Rendering relies on an inversion filter with hue rotation. Areas left untouched (images, dark blocks) keep their colors
  with **the same slight softening as the rest of the page** (≈ −10 %), and **highly saturated** colors are shifted a little
  (up to ≈ 20/255 on a pure green or blue).
- The scrollbar stays light.
- Dark PNG icons or logos on a transparent background are left as they are, so they are hard to read on a dark background
  (SVGs, however, are inverted).
- On the very first load of a site the page may stay light for a moment: the site is only remembered after the first analysis.
- A site whose dark background comes from an intermediate element may be classified "light"; it is then darkened while its
  dark blocks are left intact, which changes its look very little.
- `chrome://` pages, the Web Store and local files are not handled.

## Tests
    node test/browser.test.mjs    # real headless Helium, real screenshots, measured colors

To look at the rendering on real sites:

    SHOT_DIR=/folder SHOT_URLS=https://example.com/,https://lobste.rs/ node test/browser.test.mjs

## License
[MIT](LICENSE).
