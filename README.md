# 🖥️ Minimalist Dynamic Art Collage Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Pure Vanilla JS](https://img.shields.io/badge/Made%20with-Vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Glassmorphism UI](https://img.shields.io/badge/UI-Glassmorphism-00c8ff?style=flat-square)](https://en.wikipedia.org/wiki/Glassmorphism)

An interactive, client-side, 3D dynamic art lookbook and collage tool. Built with a distraction-free aesthetic and customizable gallery backdrops, it animates user-dropped images, GIFs, and videos across **15 distinct layout motion formulas**.

Ideal for design portfolios, visual moodboards, exhibition loops, and digital showcases.

---

## ✨ Key Features

- **🖼️ Interactive Drag & Drop (Images, GIFs & Videos):** Drop image files (`PNG`, `JPG`, `WebP`, `GIF`) or videos (`MP4`, `WebM`) directly onto the canvas, paste external media URLs, or click **✦ Try with Sample Art** to generate procedural minimalist art cards instantly.
- **💾 Full Local Persistence (IndexedDB + LocalStorage):** All media files are saved as binary blobs in IndexedDB, and all scene settings (mode, speed, scale, spread, shape, custom paths, theme, card frame) persist automatically in `localStorage`.
- **🌌 15 Motion & Layout Modes:**
  1. **3D Drift (Floating):** Floating elements with Z-depth layering.
  2. **Orbit (3D Circular):** A depth-based carousel rotating in a 3D orbit.
  3. **Orbit (2D Circular):** A flat circular carousel mapping layout coordinates.
  4. **Columns (2D Vertical):** Multi-column vertical streams moving in opposite directions.
  5. **Rows (2D Horizontal):** Multi-row horizontal streams moving in opposite directions.
  6. **Zoom (3D Tunnel):** Media travelling forward from deep space past the camera view.
  7. **Assemble (Drift/Grid Cycle):** Alternates every 12 seconds between organic drifting and gathering into a clean grid.
  8. **Grid Flow (2D Scrolling):** Three vertical scrolling columns flowing in alternating patterns.
  9. **Cinematic (Diagonal Sweep):** A smooth diagonal sweep with soft-edge borders and depth parallax.
  10. **Vortex (3D Spiral):** A cosmic whirlpool where media spirals outwards from the center, scaling up in depth.
  11. **Pendulum (Gravity Sway):** A mobile-sculpture design where items swing organically on the Z-axis from distributed ceiling anchors.
  12. **DNA Helix (Double Spiral):** Intertwined double 3D helix rotating in depth.
  13. **Wave Field (3D Ocean):** A 3D undulating ocean grid with harmonic wave elevation and tilt.
  14. **Fibonacci Sphere (3D Globe):** Evenly distributed 3D globe using the Golden Ratio Fibonacci lattice.
  15. **Shape Flow (Parametric, Text & Custom SVG):** Media flows along a **Heart**, **Star**, **Infinity**, **Butterfly**, **Lissajous**, **Spiral**, custom **Text Word** (real-time typographic contour vectorizer), **Freehand Drawing**, or **Uploaded SVG**.
- **🎨 Customizable Visual Aesthetics:**
  - **5 Backdrop Themes:** *Pure White*, *Warm Gallery*, *Studio Gray*, *Obsidian Dark*, and *Midnight Blue*.
  - **4 Card Frame Styles:** *Raw Edge*, *Soft Shadow*, *Polaroid*, and *Glass Frame*.
- **🕹️ Interactive Scene & Lightbox Inspector:**
  - **3D Mouse & Gyroscope Parallax:** Subtle 3D camera perspective shift following cursor or mobile tilt.
  - **Lightbox Preview & Individual Deletion:** Click any floating card to inspect it in high-resolution, navigate with arrow keys, download, or delete individual items.
- **📸 2x High-Res PNG & 🎥 60fps WebM Video Export:** Capture a high-density 2x PNG snapshot or record a smooth 60fps WebM video loop of the active animation, complete with active theme backgrounds and card frames.

---

## 🛠️ Interactive Controls & Shortcuts

To preserve the focus on art, the control dock remains hidden until summoned:

| Trigger Action | Description |
| :--- | :--- |
| `ESC` / `H` | Toggle the Settings Panel visibility |
| `Space` | Pause / Resume the animation |
| `P` | Toggle 3D Mouse / Gyroscope Parallax |
| **Click / Double-Click Background** | Toggle the Settings Panel visibility |
| **Click Any Media Card** | Open the Fullscreen Lightbox Inspector (`←` / `→` to navigate, `Del` to remove) |
| **Drag & Drop Files** | Instantly upload images, GIFs, or videos onto the artboard |

---

## 🚀 How to Run Locally

Since this application is 100% client-side:

1. Clone or download the repository.
2. Open **[index.html](index.html)** in any modern web browser (Chrome, Safari, Firefox, Edge).
3. Drop some images or videos onto the screen (or click *Try with Sample Art*), hit `ESC` to configure, and watch your art move.

---

## 📄 License

This project is licensed under the MIT License.

---

<p align="center">
  <sub>Made with 🤍 by <a href="https://github.com/nmaP5js">Nicolas Marie-Angélique</a></sub>
</p>
