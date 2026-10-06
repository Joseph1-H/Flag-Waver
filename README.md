# ⚑ Flag Waver

Upload any image and watch it fly as a real, wind-blown flag — rendered in 3D
with genuine cloth physics in the browser.

## What it does

- **Upload or drag-and-drop** an image; it's textured onto the flag instantly.
- **Real cloth simulation** — a Verlet-integrated particle mesh with distance
  constraints and an aerodynamic (surface-normal) wind model, so the fabric
  catches gusts and ripples the way real cloth does.
- **Live controls** — wind strength, flag shape (3:2, pennant, square, or match
  your image's aspect ratio), and a one-click **Gust**.
- **Orbit the scene** — drag to rotate, scroll to zoom.

## Tech

Plain HTML/CSS/JS with [Three.js](https://threejs.org/) (via CDN). No build step.

## Run locally

Any static server works, e.g.:

```bash
python3 -m http.server 8777
```

Then open <http://localhost:8777>.

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Markup + UI |
| `style.css`  | Styling |
| `app.js`     | Cloth simulation, Three.js scene, upload handling |
