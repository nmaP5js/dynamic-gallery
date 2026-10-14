/**
 * Dynamic Art Collage — Refactored Application
 * 
 * Architecture:
 *   - Config & State management
 *   - Database layer (IndexedDB)
 *   - Media element management
 *   - Animation engine (optimized RAF loop)
 *   - UI controllers & event bindings
 *   - File import handlers
 *   - Drawing overlay
 *   - Boot sequence
 */

// ============================================================
//  SECTION 1 — Configuration & State
// ============================================================

/** @type {Array<MediaItem>} All active collage items */
let mediaItems = [];

/** @type {number|null} Current animation frame request ID */
let animationFrameId = null;

/** @type {number} Continuous scroll offset for scrolling modes */
let scrollOffset = 0;

/** Pre-cached track counts — updated once on distribute, not every frame */
const trackCounts = {
    left: 0, right: 0,
    top: 0, bottom: 0,
    col0: 0, col1: 0, col2: 0
};

/** Linear interpolation utility */
const lerp = (a, b, t) => a + (b - a) * t;

/** Clamp utility */
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

// IndexedDB settings
const DB_NAME = 'DynamicCollageDB';
const DB_VERSION = 1;
const STORE_NAME = 'media';
let db = null;

/** Runtime configuration linked to UI controls */
const config = {
    mode: 'drift',
    speed: 0.5,
    scale: 1.0,
    spread: 1.0,
    shape: 'heart',
    customShapePoints: null
};

/** Animation constants — extracted for clarity */
const ANIM = {
    DRIFT_Z_MIN: -400,
    DRIFT_Z_MAX: 200,
    TUNNEL_Z_MIN: -2500,
    TUNNEL_Z_MAX: 500,
    VORTEX_Z_MIN: -1200,
    VORTEX_Z_MAX: 200,
    REFERENCE_SIZE: 340,
    GRID_COL_SPACING: 310,
    GRID_ROW_SPACING: 410,
    ASSEMBLE_CYCLE: 12,   // seconds
    ASSEMBLE_DRIFT: 7,    // drift phase end
    ASSEMBLE_GRID_START: 8,
    ASSEMBLE_GRID_END: 11
};


// ============================================================
//  SECTION 2 — DOM References (cached once)
// ============================================================

const DOM = {
    artboard:           document.getElementById('artboard'),
    settingsPanel:      document.getElementById('settings-panel'),
    controlMode:        document.getElementById('control-mode'),
    controlSpeed:       document.getElementById('control-speed'),
    controlScale:       document.getElementById('control-scale'),
    controlSpread:      document.getElementById('control-spread'),
    controlUpload:      document.getElementById('control-upload'),
    controlClear:       document.getElementById('control-clear'),
    controlReset:       document.getElementById('control-reset'),
    controlExport:      document.getElementById('control-export'),
    controlUrlInput:    document.getElementById('control-url-input'),
    controlUrlSubmit:   document.getElementById('control-url-submit'),
    controlShape:       document.getElementById('control-shape'),
    shapeSelectorSection: document.getElementById('shape-selector-section'),
    customModeSelect:   document.getElementById('custom-mode-select'),
    customShapeSelect:  document.getElementById('custom-shape-select'),
    controlShapeUpload: document.getElementById('control-shape-upload'),
    drawingOverlay:     document.getElementById('drawing-overlay'),
    drawingCanvas:      document.getElementById('drawing-canvas'),
    cancelDrawingBtn:   document.getElementById('cancel-drawing-btn'),
    shapeOverlay:       document.getElementById('shape-overlay'),
    shapePath:          document.getElementById('shape-path'),
    introHint:          document.getElementById('intro-hint'),
    mobileSettingsBtn:  document.getElementById('mobile-settings-btn'),
    closeSettingsBtn:   document.getElementById('close-settings-btn')
};


// ============================================================
//  SECTION 3 — Shape Math & Custom Shape Operations
// ============================================================

let isDrawing = false;
let drawingPoints = [];
let drawingCtx = null;

/**
 * Compute (x, y) coordinates on a parametric shape curve.
 * @param {string} shapeName - Shape identifier
 * @param {number} t - Parametric angle (0 to 2π)
 * @param {number} vw - Viewport width
 * @param {number} vh - Viewport height
 * @returns {{x: number, y: number}}
 */
function getShapeCoordinates(shapeName, t, vw, vh) {
    const baseSize = Math.min(vw, vh) * 0.35 * config.spread;
    let x = 0, y = 0;

    switch (shapeName) {
        case 'heart': {
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            x = (hx / 16) * baseSize;
            y = (hy / 16) * baseSize * 0.95;
            break;
        }
        case 'star': {
            const r = baseSize * (0.62 + 0.38 * Math.cos(5 * t));
            x = r * Math.sin(t);
            y = -r * Math.cos(t);
            break;
        }
        case 'infinity': {
            const denom = 1 + Math.pow(Math.sin(t), 2);
            x = (baseSize * 1.25 * Math.cos(t)) / denom;
            y = (baseSize * 1.25 * Math.sin(t) * Math.cos(t)) / denom;
            break;
        }
        case 'custom': {
            if (config.customShapePoints && config.customShapePoints.length > 0) {
                const percent = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
                const idx = Math.floor(percent * config.customShapePoints.length);
                const pt = config.customShapePoints[idx % config.customShapePoints.length];
                const customBase = Math.min(vw, vh) * 0.75 * config.spread;
                x = pt.x * customBase;
                y = pt.y * customBase;
            }
            break;
        }
        default: {
            x = baseSize * Math.cos(t);
            y = baseSize * Math.sin(t);
            break;
        }
    }

    return { x, y };
}

/** Update the SVG overlay path to visualize the current shape outline */
function updateShapeOverlayPath() {
    if (!DOM.shapeOverlay || !DOM.shapePath) return;

    if (config.mode !== 'shape') {
        DOM.shapeOverlay.style.display = 'none';
        return;
    }

    DOM.shapeOverlay.style.display = 'block';

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = vw / 2;
    const cy = vh / 2;
    const numPoints = 150;
    const points = new Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        const pt = getShapeCoordinates(config.shape, t, vw, vh);
        points[i] = `${cx + pt.x},${cy + pt.y}`;
    }

    DOM.shapePath.setAttribute('d', 'M ' + points.join(' L ') + ' Z');
}

/** Parse an SVG path `d` attribute into normalized coordinate points */
function loadCustomSvgPath(dAttribute) {
    if (!DOM.shapeOverlay) return;

    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("d", dAttribute);
    DOM.shapeOverlay.appendChild(tempPath);

    const bbox = tempPath.getBBox();
    const totalLength = tempPath.getTotalLength();

    if (totalLength === 0 || bbox.width === 0 || bbox.height === 0) {
        DOM.shapeOverlay.removeChild(tempPath);
        return;
    }

    const numSamples = 200;
    const sampledPoints = new Array(numSamples);
    const maxDim = Math.max(bbox.width, bbox.height);

    for (let i = 0; i < numSamples; i++) {
        const dist = (i / numSamples) * totalLength;
        const pt = tempPath.getPointAtLength(dist);
        sampledPoints[i] = {
            x: (pt.x - bbox.x - bbox.width / 2) / maxDim,
            y: (pt.y - bbox.y - bbox.height / 2) / maxDim
        };
    }

    DOM.shapeOverlay.removeChild(tempPath);

    config.customShapePoints = sampledPoints;
    config.shape = 'custom';
    DOM.controlShape.value = 'custom';

    ensureCustomOptionInDropdown();

    mediaItems.forEach((item, idx) => {
        item.shapeAngle = (idx * 2 * Math.PI) / Math.max(1, mediaItems.length);
    });

    updateShapeOverlayPath();
    syncCustomShapeDropdown();
}

/** Ensure the "Custom" option exists in both native and styled dropdowns */
function ensureCustomOptionInDropdown() {
    // Native select
    let customOpt = Array.from(DOM.controlShape.options).find(opt => opt.value === 'custom');
    if (!customOpt) {
        customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = 'Custom (Perso)';
        DOM.controlShape.appendChild(customOpt);
    }
    customOpt.selected = true;

    // Custom styled dropdown
    const customOptionsList = DOM.customShapeSelect.querySelector('.custom-select-options');
    let customDivOpt = customOptionsList.querySelector('.custom-option[data-value="custom"]');
    if (!customDivOpt) {
        customDivOpt = document.createElement('div');
        customDivOpt.className = 'custom-option';
        customDivOpt.setAttribute('data-value', 'custom');
        customDivOpt.textContent = 'Custom (Perso)';

        const drawOpt = customOptionsList.querySelector('.custom-option[data-value="draw"]');
        customOptionsList.insertBefore(customDivOpt, drawOpt);

        customDivOpt.addEventListener('click', () => {
            DOM.controlShape.value = 'custom';
            DOM.controlShape.dispatchEvent(new Event('change'));
            DOM.customShapeSelect.classList.remove('open');
        });
    }
}

/** Show/hide the shape selector based on current mode */
function toggleShapeSelectorVisibility() {
    if (config.mode === 'shape') {
        DOM.shapeSelectorSection.style.display = 'flex';
        updateShapeOverlayPath();
    } else {
        DOM.shapeSelectorSection.style.display = 'none';
        if (DOM.shapeOverlay) DOM.shapeOverlay.style.display = 'none';
    }
}


// ============================================================
//  SECTION 4 — Media Element Management
// ============================================================

/**
 * Create a collage media element from an image source URL.
 * @param {string} src - Image source (blob URL or HTTP URL)
 * @returns {MediaItem} The created item state object
 */
function createMediaElement(src) {
    const container = document.createElement('div');
    container.className = 'collage-item';

    const el = document.createElement('img');
    el.crossOrigin = "anonymous";
    el.src = src;

    // Setup state object first so it's available in onload
    const item = {
        element: container,
        media: el,
        baseWidth: 280,
        baseHeight: 380,
        x: 0, y: 0, z: 0,
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        dz: (Math.random() - 0.5) * 1.5,
        orbitAngle: 0,
        orbitSpeedFactor: 0.8 + Math.random() * 0.4,
        seed: Math.random() * 100,
        noiseOffset: Math.random() * Math.PI * 2
    };

    el.onload = () => {
        const aspect = el.naturalWidth / el.naturalHeight;
        setMediaDimensions(item, aspect);
    };

    container.appendChild(el);
    DOM.artboard.appendChild(container);

    // Default inline styles while loading
    container.style.width = '280px';
    container.style.height = '380px';
    container.style.marginLeft = '-140px';
    container.style.marginTop = '-190px';

    mediaItems.push(item);
    distributeElements();
    return item;
}

/**
 * Set proper dimensions based on the image's natural aspect ratio.
 * @param {MediaItem} item
 * @param {number} aspect - Width/height ratio
 */
function setMediaDimensions(item, aspect) {
    if (!aspect || isNaN(aspect)) return;

    let width, height;

    if (aspect > 1) {
        width = ANIM.REFERENCE_SIZE;
        height = ANIM.REFERENCE_SIZE / aspect;
    } else {
        height = ANIM.REFERENCE_SIZE;
        width = ANIM.REFERENCE_SIZE * aspect;
    }

    item.baseWidth = width;
    item.baseHeight = height;

    item.element.style.width = `${width}px`;
    item.element.style.height = `${height}px`;
    item.element.style.marginLeft = `${-width / 2}px`;
    item.element.style.marginTop = `${-height / 2}px`;

    distributeElements();
}

/**
 * Distribute positions, track assignments, and grid targets for all items.
 * Also pre-computes track counts for the animation loop.
 */
function distributeElements() {
    const n = mediaItems.length;
    if (n === 0) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Reset track counts
    let leftCount = 0, rightCount = 0;
    let topCount = 0, bottomCount = 0;
    const gridCols = [0, 0, 0];

    // Grid geometry for Assemble mode
    let cols = n <= 3 ? n : (n <= 6 ? 3 : 4);
    const rows = Math.ceil(n / cols);
    const gridWidth = (cols - 1) * ANIM.GRID_COL_SPACING;
    const gridHeight = (rows - 1) * ANIM.GRID_ROW_SPACING;

    mediaItems.forEach((item, i) => {
        // Orbit starting angles
        item.orbitAngle = (i * 2 * Math.PI) / n;

        // Mode-specific initial positioning
        if (config.mode === 'tunnel') {
            item.z = ANIM.TUNNEL_Z_MIN + (i / n) * 3000;
            item.x = (Math.random() - 0.5) * vw * 0.6;
            item.y = (Math.random() - 0.5) * vh * 0.6;
        } else if (config.mode === 'cinematic') {
            item.z = -200 + Math.random() * 300;
            item.x = -vw * 0.7 + (i / n) * vw * 1.4;
            item.y = vh * 0.7 - (i / n) * vh * 1.4;
        } else if (config.mode === 'vortex') {
            const maxRadius = Math.max(vw, vh) * 0.6;
            item.vortexRadius = (i / n) * maxRadius;
            item.vortexAngle = (i * 2 * Math.PI) / n + Math.random() * 0.5;
            item.z = ANIM.VORTEX_Z_MIN + (item.vortexRadius / maxRadius) * 1400;
        } else if (config.mode === 'pendulum') {
            item.anchorX = -vw * 0.55 + (i / Math.max(1, n - 1)) * vw * 1.1;
            item.pendulumLength = vh * (0.35 + 0.3 * Math.random());
            item.pendulumPhase = Math.random() * Math.PI * 2;
            item.pendulumMaxAngle = 0.15 + Math.random() * 0.15;
        } else {
            const rangeX = vw * 0.6;
            const rangeY = vh * 0.6;
            if (item.x === 0 && item.y === 0) {
                item.x = (Math.random() - 0.5) * rangeX;
                item.y = (Math.random() - 0.5) * rangeY;
                item.z = (Math.random() - 0.5) * 300;
            }
        }

        // Column track assignments (Left/Right)
        if (i % 2 === 0) {
            item.columnTrack = 'left';
            item.columnIndex = leftCount++;
        } else {
            item.columnTrack = 'right';
            item.columnIndex = rightCount++;
        }

        // Row track assignments (Top/Bottom)
        if (i % 2 === 0) {
            item.rowTrack = 'top';
            item.rowIndex = topCount++;
        } else {
            item.rowTrack = 'bottom';
            item.rowIndex = bottomCount++;
        }

        // 3-column Grid Flow assignments
        const gridColIdx = i % 3;
        item.gridColTrack = gridColIdx;
        item.gridColIndex = gridCols[gridColIdx]++;

        // Assemble mode grid targets
        const cIdx = i % cols;
        const rIdx = Math.floor(i / cols);
        item.targetGridX = cIdx * ANIM.GRID_COL_SPACING - gridWidth / 2;
        item.targetGridY = rIdx * ANIM.GRID_ROW_SPACING - gridHeight / 2;
    });

    // Cache track counts for the animation loop (avoids per-frame filter())
    trackCounts.left = leftCount;
    trackCounts.right = rightCount;
    trackCounts.top = topCount;
    trackCounts.bottom = bottomCount;
    trackCounts.col0 = gridCols[0];
    trackCounts.col1 = gridCols[1];
    trackCounts.col2 = gridCols[2];
}

/** Remove all media items from the canvas */
function clearAllMedia() {
    mediaItems.forEach(item => {
        if (item.element) item.element.remove();
    });
    mediaItems = [];
}


// ============================================================
//  SECTION 5 — Animation Engine (Optimized RAF Loop)
// ============================================================

/**
 * Main animation loop. Updates all item positions each frame.
 * Performance optimizations:
 *   - Track counts pre-cached (no per-frame filter/count)
 *   - Minimal DOM writes (single transform + opacity per item)
 *   - Constants extracted to avoid re-evaluation
 */
function animate() {
    const time = performance.now() * 0.001;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mode = config.mode;
    const speed = config.speed;
    const scale = config.scale;
    const spread = config.spread;

    scrollOffset += 1.5 * speed;

    // Drift bounds
    const marginX = vw * 0.35;
    const marginY = vh * 0.35;
    const minZ = ANIM.DRIFT_Z_MIN;
    const maxZ = ANIM.DRIFT_Z_MAX;

    // Pre-read cached track counts
    const numLeft = trackCounts.left;
    const numRight = trackCounts.right;
    const numTop = trackCounts.top;
    const numBottom = trackCounts.bottom;
    const numCol0 = trackCounts.col0;
    const numCol1 = trackCounts.col1;
    const numCol2 = trackCounts.col2;

    for (let idx = 0; idx < mediaItems.length; idx++) {
        const item = mediaItems[idx];
        let x = 0, y = 0, z = 0;

        switch (mode) {
            case 'orbit': {
                item.orbitAngle += 0.003 * speed * item.orbitSpeedFactor;
                const radiusX = (vw * 0.32) * spread;
                const radiusZ = 300 * spread;
                const radiusY = (vh * 0.1) * spread;
                x = Math.cos(item.orbitAngle) * radiusX;
                z = Math.sin(item.orbitAngle) * radiusZ;
                y = Math.sin(item.orbitAngle * 2 + item.noiseOffset) * radiusY + (Math.sin(item.seed) * vh * 0.1);
                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'orbit2d': {
                item.orbitAngle += 0.003 * speed * item.orbitSpeedFactor;
                const radiusX = (vw * 0.32) * spread;
                const radiusY = (vh * 0.25) * spread;
                x = Math.cos(item.orbitAngle) * radiusX;
                y = Math.sin(item.orbitAngle) * radiusY;
                z = 0;
                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'drift': {
                item.x += item.dx * speed;
                item.y += item.dy * speed;
                item.z += item.dz * speed;
                item.x += Math.sin(time + item.seed) * 0.2;
                item.y += Math.cos(time + item.seed) * 0.2;

                if (item.x < -marginX) { item.x = -marginX; item.dx = Math.abs(item.dx); }
                if (item.x > marginX)  { item.x = marginX; item.dx = -Math.abs(item.dx); }
                if (item.y < -marginY) { item.y = -marginY; item.dy = Math.abs(item.dy); }
                if (item.y > marginY)  { item.y = marginY; item.dy = -Math.abs(item.dy); }
                if (item.z < minZ)     { item.z = minZ; item.dz = Math.abs(item.dz); }
                if (item.z > maxZ)     { item.z = maxZ; item.dz = -Math.abs(item.dz); }

                x = item.x; y = item.y; z = item.z;
                break;
            }
            case 'columns': {
                const trackNum = item.columnTrack === 'left' ? numLeft : numRight;
                const spacingY = Math.max(440, (vh + 380) / Math.max(1, trackNum));
                const loopHeight = trackNum * spacingY;

                if (item.columnTrack === 'left') {
                    const yRaw = item.columnIndex * spacingY + scrollOffset;
                    y = ((yRaw % loopHeight) + loopHeight) % loopHeight - (loopHeight / 2);
                    x = -vw * 0.22 * spread;
                } else {
                    const yRaw = item.columnIndex * spacingY - scrollOffset;
                    y = ((yRaw % loopHeight) + loopHeight) % loopHeight - (loopHeight / 2);
                    x = vw * 0.22 * spread;
                }
                z = 0;
                break;
            }
            case 'rows': {
                const trackNum = item.rowTrack === 'top' ? numTop : numBottom;
                const spacingX = Math.max(340, (vw + 280) / Math.max(1, trackNum));
                const loopWidth = trackNum * spacingX;

                if (item.rowTrack === 'top') {
                    const xRaw = item.rowIndex * spacingX - scrollOffset;
                    x = ((xRaw % loopWidth) + loopWidth) % loopWidth - (loopWidth / 2);
                    y = -vh * 0.22 * spread;
                } else {
                    const xRaw = item.rowIndex * spacingX + scrollOffset;
                    x = ((xRaw % loopWidth) + loopWidth) % loopWidth - (loopWidth / 2);
                    y = vh * 0.22 * spread;
                }
                z = 0;
                break;
            }
            case 'tunnel': {
                item.z += 1.8 * speed;
                if (item.z > 500) {
                    item.z = ANIM.TUNNEL_Z_MIN;
                    item.x = (Math.random() - 0.5) * vw * 0.6;
                    item.y = (Math.random() - 0.5) * vh * 0.6;
                }
                x = item.x; y = item.y; z = item.z;
                break;
            }
            case 'assemble': {
                item.x += item.dx * speed;
                item.y += item.dy * speed;
                item.z += item.dz * speed;

                if (item.x < -marginX) { item.x = -marginX; item.dx = Math.abs(item.dx); }
                if (item.x > marginX)  { item.x = marginX; item.dx = -Math.abs(item.dx); }
                if (item.y < -marginY) { item.y = -marginY; item.dy = Math.abs(item.dy); }
                if (item.y > marginY)  { item.y = marginY; item.dy = -Math.abs(item.dy); }
                if (item.z < minZ)     { item.z = minZ; item.dz = Math.abs(item.dz); }
                if (item.z > maxZ)     { item.z = maxZ; item.dz = -Math.abs(item.dz); }

                const cycleTime = time % ANIM.ASSEMBLE_CYCLE;
                let t = 0;

                if (cycleTime >= ANIM.ASSEMBLE_DRIFT && cycleTime < ANIM.ASSEMBLE_GRID_START) {
                    t = cycleTime - ANIM.ASSEMBLE_DRIFT;
                } else if (cycleTime >= ANIM.ASSEMBLE_GRID_START && cycleTime < ANIM.ASSEMBLE_GRID_END) {
                    t = 1;
                } else if (cycleTime >= ANIM.ASSEMBLE_GRID_END && cycleTime < ANIM.ASSEMBLE_CYCLE) {
                    t = 1 - (cycleTime - ANIM.ASSEMBLE_GRID_END);
                }

                x = lerp(item.x, item.targetGridX * scale, t);
                y = lerp(item.y, item.targetGridY * scale, t);
                z = lerp(item.z, 0, t);
                item.gatherWeight = t;
                break;
            }
            case 'grid': {
                const colTrackIdx = item.gridColTrack;
                const trackNum = colTrackIdx === 0 ? numCol0 : (colTrackIdx === 1 ? numCol1 : numCol2);
                const spacingY = Math.max(440, (vh + 380) / Math.max(1, trackNum));
                const loopHeight = trackNum * spacingY;

                const yRaw = colTrackIdx === 1
                    ? item.gridColIndex * spacingY + scrollOffset
                    : item.gridColIndex * spacingY - scrollOffset;

                y = ((yRaw % loopHeight) + loopHeight) % loopHeight - (loopHeight / 2);
                x = (colTrackIdx - 1) * vw * 0.28 * spread;
                z = 0;
                break;
            }
            case 'cinematic': {
                const nDepth = (item.z + 200) / 300;
                const speedFactor = 0.5 + nDepth * 0.7;
                item.x += speed * 0.75 * speedFactor;
                item.y -= speed * 0.75 * speedFactor;

                const limitX = vw * 0.75;
                const limitY = vh * 0.75;

                if (item.x > limitX || item.y < -limitY) {
                    item.x = -limitX;
                    item.y = limitY + (Math.random() - 0.5) * 150;
                    item.z = -200 + Math.random() * 300;
                }

                x = item.x; y = item.y; z = item.z;

                const fadeX = Math.min(1, (limitX - Math.abs(x)) / (limitX * 0.2));
                const fadeY = Math.min(1, (limitY - Math.abs(y)) / (limitY * 0.2));
                item.fadeOpacity = clamp(fadeX * fadeY, 0, 1);
                break;
            }
            case 'vortex': {
                const maxRadius = Math.max(vw, vh) * 0.6;
                if (item.vortexRadius === undefined) {
                    item.vortexRadius = Math.random() * maxRadius;
                    item.vortexAngle = Math.random() * Math.PI * 2;
                }

                item.vortexAngle += 0.006 * speed;
                item.vortexRadius += 1.2 * speed;

                if (item.vortexRadius > maxRadius) {
                    item.vortexRadius = 0;
                    item.vortexAngle = Math.random() * Math.PI * 2;
                }

                x = Math.cos(item.vortexAngle) * item.vortexRadius * spread;
                y = Math.sin(item.vortexAngle) * item.vortexRadius * spread;
                z = ANIM.VORTEX_Z_MIN + (item.vortexRadius / maxRadius) * 1400;

                let opacityWeight = 1.0;
                if (item.vortexRadius < maxRadius * 0.15) {
                    opacityWeight = item.vortexRadius / (maxRadius * 0.15);
                } else if (item.vortexRadius > maxRadius * 0.8) {
                    opacityWeight = 1.0 - (item.vortexRadius - maxRadius * 0.8) / (maxRadius * 0.2);
                }
                item.fadeOpacity = clamp(opacityWeight, 0, 1);

                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'pendulum': {
                if (item.anchorX === undefined) {
                    item.anchorX = (Math.random() - 0.5) * vw * 0.8;
                    item.pendulumLength = vh * (0.35 + 0.3 * Math.random());
                    item.pendulumPhase = Math.random() * Math.PI * 2;
                    item.pendulumMaxAngle = 0.15 + Math.random() * 0.15;
                }

                const omega = 1.6 * speed;
                const theta = item.pendulumMaxAngle * Math.sin(omega * time + item.pendulumPhase);

                x = item.anchorX + Math.sin(theta) * item.pendulumLength * spread;
                y = -vh * 0.45 + Math.cos(theta) * item.pendulumLength;
                z = Math.sin(time + item.seed) * 50;

                item.pendulumAngle = theta * (180 / Math.PI) * 0.8;
                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'shape': {
                if (item.shapeAngle === undefined) {
                    item.shapeAngle = (idx * 2 * Math.PI) / Math.max(1, mediaItems.length);
                }

                item.shapeAngle += 0.002 * speed;
                const pt = getShapeCoordinates(config.shape, item.shapeAngle, vw, vh);
                x = pt.x;
                y = pt.y;
                z = Math.sin(item.shapeAngle * 3 + item.seed) * 80 * spread;

                item.x = x; item.y = y; item.z = z;
                break;
            }
        }

        // --- 3D Depth Rendering ---
        let modeMinZ = minZ;
        let modeMaxZ = maxZ;
        if (mode === 'tunnel')      { modeMinZ = ANIM.TUNNEL_Z_MIN; modeMaxZ = ANIM.TUNNEL_Z_MAX; }
        else if (mode === 'vortex') { modeMinZ = ANIM.VORTEX_Z_MIN; modeMaxZ = ANIM.VORTEX_Z_MAX; }

        const normalizedDepth = (z - modeMinZ) / (modeMaxZ - modeMinZ);
        const scaleFactor = (0.55 + normalizedDepth * 0.7) * scale;
        const zIndex = Math.round(normalizedDepth * 900) + 50;

        // Rotation calculation
        let angleRot = 0;
        switch (mode) {
            case 'orbit':
                angleRot = Math.cos(item.orbitAngle) * -8;
                break;
            case 'drift':
                angleRot = item.dx * 2;
                break;
            case 'assemble':
                angleRot = (item.dx * 2) * (1 - (item.gatherWeight || 0));
                break;
            case 'vortex':
                angleRot = item.vortexAngle * (180 / Math.PI) * 0.15;
                break;
            case 'pendulum':
                if (item.pendulumAngle !== undefined) angleRot = item.pendulumAngle;
                break;
            case 'shape':
                if (item.shapeAngle !== undefined) angleRot = Math.cos(item.shapeAngle) * -8;
                break;
        }

        // Opacity: solid by default, soft fade for cinematic/vortex
        const finalOpacity = (mode === 'cinematic' || mode === 'vortex')
            ? (item.fadeOpacity !== undefined ? item.fadeOpacity : 1.0)
            : 1.0;

        // Cache render coordinates for canvas export
        item.renderX = x;
        item.renderY = y;
        item.renderScale = scaleFactor;
        item.renderAngle = angleRot;
        item.renderZ = z;

        // Single composite DOM write per item
        const el = item.element;
        el.style.zIndex = zIndex;
        el.style.opacity = finalOpacity;
        el.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateY(${angleRot}deg) scale(${scaleFactor})`;
    }

    animationFrameId = requestAnimationFrame(animate);
}


// ============================================================
//  SECTION 6 — IndexedDB Operations
// ============================================================

/** Initialize the IndexedDB database */
function initDB(callback) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
    };
    request.onsuccess = (e) => {
        db = e.target.result;
        if (callback) callback();
    };
    request.onerror = (e) => {
        console.error('IndexedDB initialization failed:', e);
        if (callback) callback();
    };
}

/** Save a media file (Blob or URL string) to the database */
function saveMediaToDB(file) {
    if (!db) return;
    try {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).add({
            blob: file,
            isVideo: false,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to save media to database:', err);
    }
}

/** Load all persisted media from the database */
function loadMediaFromDB() {
    if (!db) return;
    const tx = db.transaction([STORE_NAME], 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();

    request.onsuccess = (e) => {
        const items = e.target.result;
        if (items && items.length > 0) {
            hideIntroHint();
            items.forEach((record) => {
                if (record.isVideo) return;

                let url;
                if (record.blob instanceof Blob) {
                    url = URL.createObjectURL(record.blob);
                } else if (typeof record.blob === 'string') {
                    url = record.blob;
                } else {
                    return;
                }

                const mediaItem = createMediaElement(url);
                const rangeX = window.innerWidth * 0.5;
                const rangeY = window.innerHeight * 0.5;
                mediaItem.x = (Math.random() - 0.5) * rangeX;
                mediaItem.y = (Math.random() - 0.5) * rangeY;
                mediaItem.z = (Math.random() - 0.5) * 300;
                mediaItem.orbitAngle = Math.random() * Math.PI * 2;
            });
            distributeElements();
        }
    };
}

/** Clear all media records from the database */
function clearMediaDB() {
    if (!db) return;
    try {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).clear();
    } catch (err) {
        console.error('Failed to clear media database:', err);
    }
}


// ============================================================
//  SECTION 7 — Export
// ============================================================

/** Export the current collage as a 2x resolution PNG */
function exportCollageAsImage() {
    if (mediaItems.length === 0) return;

    const canvas = document.createElement('canvas');
    const dpr = 2;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sortedItems = [...mediaItems].sort((a, b) => a.z - b.z);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    sortedItems.forEach((item) => {
        const rx = item.renderX ?? item.x;
        const ry = item.renderY ?? item.y;
        const rScale = item.renderScale ?? 1;
        const rAngle = item.renderAngle ?? 0;
        const rOpacity = item.fadeOpacity ?? 1.0;

        ctx.save();
        ctx.globalAlpha = rOpacity;
        ctx.translate(cx + rx * dpr, cy + ry * dpr);
        ctx.rotate(rAngle * Math.PI / 180);
        ctx.scale(rScale * dpr, rScale * dpr);

        try {
            ctx.drawImage(item.media, -item.baseWidth / 2, -item.baseHeight / 2, item.baseWidth, item.baseHeight);
        } catch (e) {
            console.error('Failed to draw element onto canvas:', e);
        }

        ctx.restore();
    });

    try {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'collage.png';
        link.href = dataUrl;
        link.click();
    } catch (err) {
        console.error('Failed to export collage image:', err);
    }
}


// ============================================================
//  SECTION 8 — UI Controllers & Event Bindings
// ============================================================

/** Toggle settings panel visibility */
function toggleSettings() {
    DOM.settingsPanel.classList.toggle('hidden');
    hideIntroHint();
    if (DOM.mobileSettingsBtn) {
        DOM.mobileSettingsBtn.classList.toggle('panel-open', !DOM.settingsPanel.classList.contains('hidden'));
    }
}

/** Fade out and remove the intro hint */
function hideIntroHint() {
    if (DOM.introHint && !DOM.introHint.classList.contains('fade-out')) {
        DOM.introHint.classList.add('fade-out');
        setTimeout(() => DOM.introHint.remove(), 500);
    }
}

// --- Keyboard shortcuts ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') {
        toggleSettings();
    }
});

// --- Close button on mobile panel ---
if (DOM.closeSettingsBtn) {
    DOM.closeSettingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        DOM.settingsPanel.classList.add('hidden');
        if (DOM.mobileSettingsBtn) DOM.mobileSettingsBtn.classList.remove('panel-open');
    });
}

// --- Floating mobile settings button ---
if (DOM.mobileSettingsBtn) {
    DOM.mobileSettingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSettings();
    });
}

// --- Double-click toggle on background ---
DOM.artboard.addEventListener('dblclick', (e) => {
    if (!DOM.settingsPanel.contains(e.target)) {
        toggleSettings();
    }
});

// --- Reliable tap / touch toggle on background ---
let artboardTouchStartX = 0;
let artboardTouchStartY = 0;
let artboardTouchStartTime = 0;

DOM.artboard.addEventListener('touchstart', (e) => {
    artboardTouchStartX = e.touches[0].clientX;
    artboardTouchStartY = e.touches[0].clientY;
    artboardTouchStartTime = Date.now();
}, { passive: true });

DOM.artboard.addEventListener('touchend', (e) => {
    if (artboardTouchStartTime === 0) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dist = Math.hypot(endX - artboardTouchStartX, endY - artboardTouchStartY);
    const duration = Date.now() - artboardTouchStartTime;
    artboardTouchStartTime = 0;

    // Clean tap on background (< 12px movement, < 300ms duration)
    if (dist < 12 && duration < 300) {
        if (!DOM.settingsPanel.contains(e.target) && (!DOM.mobileSettingsBtn || !DOM.mobileSettingsBtn.contains(e.target))) {
            toggleSettings();
        }
    }
}, { passive: true });

DOM.artboard.addEventListener('click', (e) => {
    if (e.target === DOM.artboard) {
        toggleSettings();
    }
});

// --- Sync custom styled dropdowns with native selects ---
function syncCustomModeDropdown() {
    const val = DOM.controlMode.value;
    const trigger = DOM.customModeSelect.querySelector('.custom-select-trigger');
    const selectedOption = DOM.customModeSelect.querySelector(`.custom-option[data-value="${val}"]`);

    if (selectedOption) {
        if (trigger) trigger.textContent = selectedOption.textContent;
        DOM.customModeSelect.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
        selectedOption.classList.add('selected');
    }
}

function syncCustomShapeDropdown() {
    const val = DOM.controlShape.value;
    const trigger = DOM.customShapeSelect.querySelector('.custom-select-trigger');
    const selectedOption = DOM.customShapeSelect.querySelector(`.custom-option[data-value="${val}"]`);

    if (selectedOption) {
        if (trigger) trigger.textContent = selectedOption.textContent;
        DOM.customShapeSelect.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
        selectedOption.classList.add('selected');
    }
}

// --- Mode change ---
DOM.controlMode.addEventListener('change', (e) => {
    config.mode = e.target.value;
    distributeElements();
    syncCustomModeDropdown();
    toggleShapeSelectorVisibility();
});

// --- Custom mode dropdown ---
const customModeTrigger = DOM.customModeSelect.querySelector('.custom-select-trigger');
const customModeOptions = DOM.customModeSelect.querySelectorAll('.custom-option');

customModeTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.customModeSelect.classList.toggle('open');
    DOM.customShapeSelect.classList.remove('open');
});

customModeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        DOM.controlMode.value = opt.getAttribute('data-value');
        DOM.controlMode.dispatchEvent(new Event('change'));
        DOM.customModeSelect.classList.remove('open');
    });
});

// --- Custom shape dropdown ---
const customShapeTrigger = DOM.customShapeSelect.querySelector('.custom-select-trigger');

customShapeTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.customModeSelect.classList.remove('open');
    DOM.customShapeSelect.classList.toggle('open');
});

function bindCustomShapeOptions() {
    DOM.customShapeSelect.querySelectorAll('.custom-option').forEach(opt => {
        opt.onclick = () => {
            DOM.controlShape.value = opt.getAttribute('data-value');
            DOM.controlShape.dispatchEvent(new Event('change'));
            DOM.customShapeSelect.classList.remove('open');
        };
    });
}
bindCustomShapeOptions();

// --- Shape change ---
DOM.controlShape.addEventListener('change', (e) => {
    const val = e.target.value;

    if (val === 'draw') {
        startInteractiveDrawing();
        DOM.controlShape.value = config.shape;
        syncCustomShapeDropdown();
    } else if (val === 'upload') {
        DOM.controlShapeUpload.click();
        DOM.controlShape.value = config.shape;
        syncCustomShapeDropdown();
    } else {
        config.shape = val;
        mediaItems.forEach((item, idx) => {
            item.shapeAngle = (idx * 2 * Math.PI) / Math.max(1, mediaItems.length);
        });
        updateShapeOverlayPath();
        syncCustomShapeDropdown();
    }
});

// --- Close dropdowns on outside click ---
window.addEventListener('click', () => {
    DOM.customModeSelect.classList.remove('open');
    DOM.customShapeSelect.classList.remove('open');
});

// --- Parameter sliders ---
DOM.controlSpeed.addEventListener('input', (e) => { config.speed = parseFloat(e.target.value); });
DOM.controlScale.addEventListener('input', (e) => { config.scale = parseFloat(e.target.value); });
DOM.controlSpread.addEventListener('input', (e) => {
    config.spread = parseFloat(e.target.value);
    updateShapeOverlayPath();
});

// --- Action buttons ---
DOM.controlClear.addEventListener('click', () => {
    clearAllMedia();
    clearMediaDB();
});

DOM.controlReset.addEventListener('click', () => {
    clearAllMedia();
    clearMediaDB();

    config.mode = 'drift';
    config.speed = 0.5;
    config.scale = 1.0;
    config.spread = 1.0;
    config.shape = 'heart';

    DOM.controlMode.value = 'drift';
    DOM.controlSpeed.value = 0.5;
    DOM.controlScale.value = 1.0;
    DOM.controlSpread.value = 1.0;
    DOM.controlShape.value = 'heart';

    // Clean up injected custom option
    const customOpt = Array.from(DOM.controlShape.options).find(opt => opt.value === 'custom');
    if (customOpt) customOpt.remove();
    const customDivOpt = DOM.customShapeSelect.querySelector('.custom-option[data-value="custom"]');
    if (customDivOpt) customDivOpt.remove();
    bindCustomShapeOptions();

    syncCustomModeDropdown();
    syncCustomShapeDropdown();
    toggleShapeSelectorVisibility();
});

DOM.controlExport.addEventListener('click', exportCollageAsImage);

// --- Debounced resize handler ---
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        updateShapeOverlayPath();
        distributeElements();
    }, 150);
});


// ============================================================
//  SECTION 9 — Interactive Custom Drawing Canvas
// ============================================================

function startInteractiveDrawing() {
    DOM.drawingOverlay.style.display = 'flex';
    DOM.drawingCanvas.width = window.innerWidth;
    DOM.drawingCanvas.height = window.innerHeight;

    drawingCtx = DOM.drawingCanvas.getContext('2d');
    drawingCtx.strokeStyle = '#111111';
    drawingCtx.lineWidth = 3.5;
    drawingCtx.lineCap = 'round';
    drawingCtx.lineJoin = 'round';
    drawingCtx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    drawingCtx.shadowBlur = 8;

    drawingPoints = [];
    isDrawing = false;
}

function stopInteractiveDrawing(save = false) {
    DOM.drawingOverlay.style.display = 'none';
    if (save && drawingPoints.length > 8) {
        let d = `M ${drawingPoints[0].x} ${drawingPoints[0].y}`;
        for (let i = 1; i < drawingPoints.length; i++) {
            d += ` L ${drawingPoints[i].x} ${drawingPoints[i].y}`;
        }
        d += ' Z';
        loadCustomSvgPath(d);
    }
    drawingPoints = [];
    isDrawing = false;
}

DOM.cancelDrawingBtn.addEventListener('click', () => stopInteractiveDrawing(false));

function getPointerPos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function handleDrawStart(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getPointerPos(DOM.drawingCanvas, e);
    drawingPoints.push(pos);
    drawingCtx.beginPath();
    drawingCtx.moveTo(pos.x, pos.y);
}

function handleDrawMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPointerPos(DOM.drawingCanvas, e);
    drawingPoints.push(pos);
    drawingCtx.lineTo(pos.x, pos.y);
    drawingCtx.stroke();
}

function handleDrawEnd(e) {
    if (!isDrawing) return;
    e.preventDefault();
    stopInteractiveDrawing(true);
}

DOM.drawingCanvas.addEventListener('mousedown', handleDrawStart);
DOM.drawingCanvas.addEventListener('mousemove', handleDrawMove);
window.addEventListener('mouseup', (e) => {
    if (isDrawing && e.target === DOM.drawingCanvas) {
        handleDrawEnd(e);
    } else {
        isDrawing = false;
    }
});

DOM.drawingCanvas.addEventListener('touchstart', handleDrawStart, { passive: false });
DOM.drawingCanvas.addEventListener('touchmove', handleDrawMove, { passive: false });
DOM.drawingCanvas.addEventListener('touchend', handleDrawEnd);


// ============================================================
//  SECTION 10 — SVG File Upload Handler
// ============================================================

DOM.controlShapeUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const svgText = evt.target.result;
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const pathEl = doc.querySelector('path, polygon, polyline, circle, rect, ellipse');

        if (!pathEl) {
            alert("No vector path geometry found inside the SVG. Please make sure it contains a valid path or shape.");
            return;
        }

        let d = "";
        const tagName = pathEl.tagName.toLowerCase();

        if (tagName === 'path') {
            d = pathEl.getAttribute('d');
        } else if (tagName === 'polygon' || tagName === 'polyline') {
            const pairs = pathEl.getAttribute('points').trim().split(/\s+/);
            if (pairs.length > 2) {
                d = `M ${pairs[0].replace(',', ' ')}`;
                for (let i = 1; i < pairs.length; i++) {
                    d += ` L ${pairs[i].replace(',', ' ')}`;
                }
                d += ' Z';
            }
        } else if (tagName === 'circle') {
            const cx = parseFloat(pathEl.getAttribute('cx') || 0);
            const cy = parseFloat(pathEl.getAttribute('cy') || 0);
            const r = parseFloat(pathEl.getAttribute('r') || 0);
            d = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
        } else if (tagName === 'rect') {
            const rx = parseFloat(pathEl.getAttribute('x') || 0);
            const ry = parseFloat(pathEl.getAttribute('y') || 0);
            const w = parseFloat(pathEl.getAttribute('width') || 0);
            const h = parseFloat(pathEl.getAttribute('height') || 0);
            d = `M ${rx} ${ry} L ${rx + w} ${ry} L ${rx + w} ${ry + h} L ${rx} ${ry + h} Z`;
        }

        if (d) {
            loadCustomSvgPath(d);
        } else {
            alert("Unable to parse vector shape coordinates from SVG file.");
        }
    };
    reader.readAsText(file);
    e.target.value = "";
});


// ============================================================
//  SECTION 11 — File Import (Picker & Drag/Drop)
// ============================================================

/**
 * Process dropped/selected image files.
 * @param {FileList} files
 */
function handleFiles(files) {
    if (files.length === 0) return;
    hideIntroHint();

    Array.from(files).forEach((file) => {
        if (!file.type.startsWith('image/')) return;

        saveMediaToDB(file);
        const url = URL.createObjectURL(file);
        const item = createMediaElement(url);

        const rangeX = window.innerWidth * 0.5;
        const rangeY = window.innerHeight * 0.5;
        item.x = (Math.random() - 0.5) * rangeX;
        item.y = (Math.random() - 0.5) * rangeY;
        item.z = (Math.random() - 0.5) * 300;
        item.orbitAngle = Math.random() * Math.PI * 2;
    });
}

/**
 * Process an image URL input.
 * @param {string} url
 */
function handleURL(url) {
    if (!url) return;
    url = url.trim();
    if (url === "") return;

    hideIntroHint();

    const addImage = (src, blobOrUrlToSave) => {
        saveMediaToDB(blobOrUrlToSave);
        const item = createMediaElement(src);
        const rangeX = window.innerWidth * 0.5;
        const rangeY = window.innerHeight * 0.5;
        item.x = (Math.random() - 0.5) * rangeX;
        item.y = (Math.random() - 0.5) * rangeY;
        item.z = (Math.random() - 0.5) * 300;
        item.orbitAngle = Math.random() * Math.PI * 2;
    };

    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.blob();
        })
        .then(blob => {
            if (!blob.type.startsWith('image/')) {
                alert('Only image or GIF URLs are supported.');
                return;
            }
            const localUrl = URL.createObjectURL(blob);
            addImage(localUrl, blob);
            DOM.controlUrlInput.value = "";
        })
        .catch(err => {
            console.warn('CORS or network error fetching URL as blob. Falling back to direct URL load:', err);
            addImage(url, url);
            DOM.controlUrlInput.value = "";
        });
}

// URL input bindings
DOM.controlUrlSubmit.addEventListener('click', () => handleURL(DOM.controlUrlInput.value));
DOM.controlUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleURL(DOM.controlUrlInput.value);
    }
});

// File picker
DOM.controlUpload.addEventListener('change', (e) => handleFiles(e.target.files));

// Drag & Drop
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('drag-over');
});

window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (e.clientX === 0 && e.clientY === 0) {
        document.body.classList.remove('drag-over');
    }
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files) {
        handleFiles(e.dataTransfer.files);
    }
});


// ============================================================
//  SECTION 12 — Mobile Touch Gestures (Swipe Up / Down)
// ============================================================

let gestureStartY = 0;
let gestureStartTime = 0;

document.addEventListener('touchstart', (e) => {
    gestureStartY = e.touches[0].clientY;
    gestureStartTime = Date.now();
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (gestureStartY === 0) return;

    const gestureEndY = e.changedTouches[0].clientY;
    const deltaY = gestureStartY - gestureEndY;
    const elapsed = Date.now() - gestureStartTime;

    // Fast swipe gesture (distance > 50px, elapsed < 400ms)
    if (Math.abs(deltaY) > 50 && elapsed < 400) {
        // Swipe UP anywhere in lower half of screen: open panel
        if (deltaY > 50 && DOM.settingsPanel.classList.contains('hidden') && gestureStartY > window.innerHeight * 0.5) {
            DOM.settingsPanel.classList.remove('hidden');
            hideIntroHint();
            if (DOM.mobileSettingsBtn) DOM.mobileSettingsBtn.classList.add('panel-open');
        }
        // Swipe DOWN starting from top half: close panel
        else if (deltaY < -50 && !DOM.settingsPanel.classList.contains('hidden') && gestureStartY < window.innerHeight * 0.45) {
            DOM.settingsPanel.classList.add('hidden');
            if (DOM.mobileSettingsBtn) DOM.mobileSettingsBtn.classList.remove('panel-open');
        }
    }

    gestureStartY = 0;
}, { passive: true });


// ============================================================
//  SECTION 13 — Boot Sequence
// ============================================================

initDB(() => {
    loadMediaFromDB();
    animate();
    DOM.settingsPanel.classList.add('hidden');
    if (DOM.mobileSettingsBtn) DOM.mobileSettingsBtn.classList.remove('panel-open');
    syncCustomModeDropdown();
    syncCustomShapeDropdown();
    toggleShapeSelectorVisibility();
});
