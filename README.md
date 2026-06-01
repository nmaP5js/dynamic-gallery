# 🖥️ Minimalist Dynamic Art Collage Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Pure Vanilla JS](https://img.shields.io/badge/Made%20with-Vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Glassmorphism UI](https://img.shields.io/badge/UI-Glassmorphism-00c8ff?style=flat-square)](https://en.wikipedia.org/wiki/Glassmorphism)

An interactive, client-side, dynamic art lookbook and collage tool. Built with a raw, distraction-free aesthetic on a pure white canvas, it animates user-dropped images across 9 distinct layout motion formulas. 

Ideal for design portfolios, visual boards, exhibition loops, and digital showcases.

---

## ✨ Key Features

- **🖼️ Interactive Drag & Drop:** Drop any image files directly onto the canvas to automatically begin animating.
- **💾 Local Persistence (IndexedDB):** All dropped images are saved as binary blobs locally in your browser. Reopening or reloading the page retains your collage perfectly without losing files.
- **🌌 9 Motion & Layout Modes:**
  1. **3D Drift (Floating):** Floating elements with Z-depth layering.
  2. **Orbit (3D Circular):** A depth-based carousel rotating in a 3D orbit.
  3. **Orbit (2D Circular):** A flat circular carousel mapping layout coordinates.
  4. **Columns (2D Vertical):** Multi-column vertical streams moving in opposite directions.
  5. **Rows (2D Horizontal):** Multi-row horizontal streams moving in opposite directions.
  6. **Zoom (3D Tunnel):** Images travelling forward from deep space past the camera view.
  7. **Assemble (Drift/Grid Cycle):** Alternates every 12 seconds between organic drifting and gathering into a flat clean grid.
  8. **Grid Flow (2D Scrolling):** Three vertical scrolling columns flowing in alternating patterns.
  9. **Cinematic (Diagonal Sweep):** A smooth diagonal sweep with soft-edge borders and depth parallax.
- **⚙️ Custom Parameters:** Fine-tune the speed, size scales, and spatial spread dynamically using a minimalist glassmorphic control panel.
- **📸 2x High-Resolution Export:** Capture and export the collage layout as a high-density PNG file (`collage.png`) instantly. Works completely offline.
- **📱 Responsive & Touch Ready:** Full screen support for mobile taps and responsive layout dynamics.

---

## 🛠️ Interactive Controls

To preserve the focus on art, the interface features **no default visible buttons**. The control panel slides in smoothly only when triggered:

| Trigger Action | Description |
| :--- | :--- |
| `ESC` / `H` | Toggle the Settings Panel visibility |
| **Double-Click Background** | Toggle the Settings Panel visibility |
| **Tap/Click Empty Space** | Toggle the Settings Panel visibility |
| **Drag & Drop Files** | Instantly upload and load images onto the artboard |

---

## 🏗️ Technical Stack

- **HTML5 & CSS3:** Modern vanilla styling, 3D CSS perspective spaces (`perspective: 1200px`), and `backdrop-filter` rules for a sleek glassmorphic settings panel.
- **Vanilla JavaScript:** Custom physics-inspired movement formulas powered by a performance-focused `requestAnimationFrame` render loop.
- **IndexedDB Store:** Handled natively to store images as Blobs, bypassing local disk limitations and CORS issues.
- **Google Fonts:** Sleek typography integrated via `Outfit` / `Inter`.

---

## 🚀 How to Run Locally

Since this application is 100% client-side:

1. Clone or download the repository.
2. Open **[index.html](index.html)** in any modern web browser (Chrome, Safari, Firefox, Edge).
3. Drop some images onto the screen, hit `ESC` to configure, and watch your art drift.

---

## 📄 License

This project is licensed under the MIT License.

---

<p align="center">
  <sub>Made with 🤍 by <a href="https://github.com/nmaP5js">Nicolas Marie-Angélique</a></sub>
</p>
