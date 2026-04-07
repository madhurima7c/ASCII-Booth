# ASCII Booth

A static page that uses your webcam to capture one frame and render it as ASCII art in the browser. **Nothing is uploaded or stored**—all processing stays in your tab.

## Run locally

The camera needs a **secure context** (**HTTPS** or **`http://localhost`**). Opening `index.html` as `file://` usually blocks the camera.

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) (or use `npx serve`).

## Deploy on Vercel

This folder is a **static site** (no build step). From this directory:

```bash
cd ascii-selfie
npx vercel
```

For production:

```bash
npx vercel --prod
```

If the Git repo root is **`personal-projects`** (parent of `ascii-selfie`), set **Root Directory** to **`ascii-selfie`** in the Vercel project settings, or run the CLI from inside `ascii-selfie` as above.

Camera access requires **HTTPS**; Vercel previews and production URLs are HTTPS by default.

## Use

1. Tap **Capture** to start the camera (allow access when prompted).
2. Tap **Capture** again when you are ready to generate ASCII in the viewfinder.
3. Tap **Capture** again to return to the live preview (retake).
4. Use the **color circles** to change the ASCII background; the **rainbow** circle opens a custom color swatch (saturation/brightness square + hue strip). ASCII text stays white for contrast.
5. Closing the tab stops the camera. See `fonts/README.txt` for the **PP BitNeu** title font.

## Files

- `index.html` — booth layout, viewfinder, swatches, popover
- `styles.css` — light “booth” UI, `@font-face` for PP BitNeu
- `app.js` — camera flow, HSV swatch, ASCII conversion
- `fonts/` — place `PPBitNeu.woff2` / `.woff` / `.ttf` here (optional)
