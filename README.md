# Cantonese Speak & Insert

Minimal Chrome extension for Cantonese voice typing.  
Press once, speak, and your text is inserted into the currently focused input field.

## Features

- Clean side panel UI with one main button: `Speak & Insert`
- Keyboard shortcut quick flow: double-press `Control`
- Auto insert into `input`, `textarea`, and `contenteditable`
- Supports Cantonese recognition (`yue-Hant-HK` default)

## Installation (Local / GitHub Download)

1. Download this repo as ZIP, then extract it  
   or clone it with Git.
2. Open Chrome: `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this project folder

## Usage

### Side Panel

1. Open any normal website tab (`https://...`)
2. Click into a text box
3. Open extension side panel
4. Press **Speak & Insert**
5. Speak, then pause (or press again to stop)

### Keyboard Shortcut

1. Click into a text box
2. Double-press `Control`
3. A small recording bubble appears
4. Speak and pause to auto insert

If shortcut appears to do nothing:
- Press `Control` twice quickly (within about half a second).
- Use a normal website tab (`https://...`), not `chrome://...` or extension/internal pages.
- Focus a supported field (`input`, `textarea`, or `contenteditable`) before pressing the shortcut.
- Confirm microphone permission is allowed for the current site.

## Important Notes

- Chrome internal pages like `chrome://...` do not allow text insertion
- Microphone permission is required on first use
- Accuracy depends on browser support, network, and mic quality

## Project Structure

- `manifest.json` - Chrome extension manifest (MV3)
- `service-worker.js` - background/service worker logic
- `content-script.js` - in-page quick voice overlay and insert flow
- `panel.html` - side panel markup
- `panel.css` - side panel styling
- `panel.js` - side panel interaction logic

## Publishing Checklist

1. Confirm extension name/version in `manifest.json`
2. Add a `LICENSE` file (recommended)
3. Add screenshots/GIF for GitHub README (recommended)
4. Tag a release if you want downloadable versions
