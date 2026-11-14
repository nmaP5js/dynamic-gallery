/**
 * Dynamic Art Collage — Interactive 3D Lookbook & Motion Tool
 *
 * Architecture:
 *   1. Config, Themes & State Management (with localStorage persistence)
 *   2. DOM References
 *   3. Shape Math, Text-to-Path Vectorizer & Custom SVG Operations
 *   4. Media Element Management (Images & Videos, CORS fallback, Memory cleanup)
 *   5. Animation Engine (15 modes, 3D Parallax, Pause support, RAF loop)
 *   6. IndexedDB Persistence Layer (with individual item deletion)
 *   7. High-Res PNG Export & Real-Time WebM Video Recorder
 *   8. Interactive Lightbox Modal & Sample Art Generator
 *   9. UI Controllers, Custom Dropdowns & Event Bindings
 *  10. Interactive Custom Drawing Canvas
 *  11. SVG & Media File / URL Import Handlers
 *  12. Mobile Touch Gestures
 *  13. Boot Sequence
 */

// ============================================================
//  SECTION 1 — Configuration, Themes & State
// ============================================================

/** @type {Array<Object>} All active collage media items */
let mediaItems = [];

/** @type {number|null} Current animation frame request ID */
let animationFrameId = null;

/** @type {number} Continuous scroll offset for scrolling modes */
let scrollOffset = 0;

/** @type {number} Accumulated animation time in seconds (respects pause) */
let animTime = 0;

/** @type {number} Last frame timestamp from performance.now() */
let lastFrameTime = performance.now();

/** 3D Parallax state (normalized -1 to 1 target & smoothed current) */
const parallaxState = {
    targetX: 0,
    targetY: 0,
    currentX: 0,
    currentY: 0
};

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

// IndexedDB & LocalStorage settings
const DB_NAME = 'DynamicCollageDB';
const DB_VERSION = 1;
const STORE_NAME = 'media';
const CONFIG_STORAGE_KEY = 'DynamicCollageConfig_v1';
let db = null;

/** Theme background colors for export canvas & meta theme-color */
const THEME_BG_COLORS = {
    light: '#ffffff',
    warm: '#f6f3ec',
    gray: '#ebedf0',
    dark: '#0c0d10',
    midnight: '#07101e'
};

/** Default configuration */
const DEFAULT_CONFIG = {
    mode: 'drift',
    speed: 0.5,
    scale: 1.0,
    spread: 1.0,
    shape: 'heart',
    customShapePoints: null,
    customText: 'ART',
    theme: 'light',
    cardStyle: 'minimal',
    parallax: true
};

/** Runtime configuration linked to UI controls */
const config = {
    ...DEFAULT_CONFIG,
    paused: false
};

/** Animation constants */
const ANIM = {
    DRIFT_Z_MIN: -400,
    DRIFT_Z_MAX: 200,
    TUNNEL_Z_MIN: -2500,
    TUNNEL_Z_MAX: 500,
    VORTEX_Z_MIN: -1200,
    VORTEX_Z_MAX: 200,
    SPHERE_Z_MIN: -500,
    SPHERE_Z_MAX: 500,
    REFERENCE_SIZE: 340,
    GRID_COL_SPACING: 310,
    GRID_ROW_SPACING: 410,
    ASSEMBLE_CYCLE: 12,
    ASSEMBLE_DRIFT: 7,
    ASSEMBLE_GRID_START: 8,
    ASSEMBLE_GRID_END: 11
};

/** Save user configuration to localStorage */
function saveConfigToStorage() {
    try {
        const toSave = {
            mode: config.mode,
            speed: config.speed,
            scale: config.scale,
            spread: config.spread,
            shape: config.shape,
            customShapePoints: config.customShapePoints,
            customText: config.customText,
            theme: config.theme,
            cardStyle: config.cardStyle,
            parallax: config.parallax
        };
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(toSave));
    } catch (err) {
        console.warn('Unable to save config to localStorage:', err);
    }
}

/** Load user configuration from localStorage */
function loadConfigFromStorage() {
    try {
        const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            if (typeof parsed.mode === 'string') config.mode = parsed.mode;
            if (typeof parsed.speed === 'number') config.speed = clamp(parsed.speed, 0.05, 3);
            if (typeof parsed.scale === 'number') config.scale = clamp(parsed.scale, 0.2, 2.5);
            if (typeof parsed.spread === 'number') config.spread = clamp(parsed.spread, 0.1, 2);
            if (typeof parsed.shape === 'string') config.shape = parsed.shape;
            if (Array.isArray(parsed.customShapePoints)) config.customShapePoints = parsed.customShapePoints;
            if (typeof parsed.customText === 'string' && parsed.customText.trim()) config.customText = parsed.customText;
            if (typeof parsed.theme === 'string' && THEME_BG_COLORS[parsed.theme]) config.theme = parsed.theme;
            if (typeof parsed.cardStyle === 'string') config.cardStyle = parsed.cardStyle;
            if (typeof parsed.parallax === 'boolean') config.parallax = parsed.parallax;
        }
    } catch (err) {
        console.warn('Unable to load config from localStorage:', err);
    }
}


// ============================================================
//  SECTION 2 — DOM References (cached once)
// ============================================================

const DOM = {
    artboard:             document.getElementById('artboard'),
    settingsPanel:        document.getElementById('settings-panel'),
    controlMode:          document.getElementById('control-mode'),
    controlSpeed:         document.getElementById('control-speed'),
    controlScale:         document.getElementById('control-scale'),
    controlSpread:        document.getElementById('control-spread'),
    controlPause:         document.getElementById('control-pause'),
    pauseIcon:            document.getElementById('pause-icon'),
    controlParallax:      document.getElementById('control-parallax'),
    controlCardStyle:     document.getElementById('control-card-style'),
    customCardSelect:     document.getElementById('custom-card-select'),
    themeSwatches:        document.querySelectorAll('.theme-swatch'),
    metaThemeColor:       document.getElementById('meta-theme-color'),
    controlUpload:        document.getElementById('control-upload'),
    mediaCountBadge:      document.getElementById('media-count-badge'),
    controlClear:         document.getElementById('control-clear'),
    controlReset:         document.getElementById('control-reset'),
    controlExport:        document.getElementById('control-export'),
    controlRecord:        document.getElementById('control-record'),
    controlUrlInput:      document.getElementById('control-url-input'),
    controlUrlSubmit:     document.getElementById('control-url-submit'),
    controlShape:         document.getElementById('control-shape'),
    controlShapeText:     document.getElementById('control-shape-text'),
    shapeSelectorSection: document.getElementById('shape-selector-section'),
    customModeSelect:     document.getElementById('custom-mode-select'),
    customShapeSelect:    document.getElementById('custom-shape-select'),
    controlShapeUpload:   document.getElementById('control-shape-upload'),
    drawingOverlay:       document.getElementById('drawing-overlay'),
    drawingCanvas:        document.getElementById('drawing-canvas'),
    cancelDrawingBtn:     document.getElementById('cancel-drawing-btn'),
    shapeOverlay:         document.getElementById('shape-overlay'),
    shapePath:            document.getElementById('shape-path'),
    introHint:            document.getElementById('intro-hint'),
    loadSamplesBtn:       document.getElementById('load-samples-btn'),
    statusPill:           document.getElementById('status-pill'),
    statusText:           document.getElementById('status-text'),
    mobileSettingsBtn:    document.getElementById('mobile-settings-btn'),
    closeSettingsBtn:     document.getElementById('close-settings-btn'),
    lightboxModal:        document.getElementById('lightbox-modal'),
    lightboxBackdrop:     document.getElementById('lightbox-backdrop'),
    lightboxMediaWrapper: document.getElementById('lightbox-media-wrapper'),
    lightboxCounter:      document.getElementById('lightbox-counter'),
    lightboxPrev:         document.getElementById('lightbox-prev'),
    lightboxNext:         document.getElementById('lightbox-next'),
    lightboxDownload:     document.getElementById('lightbox-download'),
    lightboxDelete:       document.getElementById('lightbox-delete'),
    lightboxClose:        document.getElementById('lightbox-close')
};


// ============================================================
//  SECTION 3 — Shape Math, Text Vectorizer & Custom SVG
// ============================================================

let isDrawing = false;
let drawingPoints = [];
let drawingCtx = null;
let cachedTextPoints = [];
let cachedTextString = '';

/**
 * Vectorize a short text string into normalized contour coordinate points.
 * Renders the text onto an offscreen canvas and extracts edge pixels.
 * @param {string} text
 * @returns {Array<{x: number, y: number}>}
 */
function generateTextShapePoints(text) {
    const cleanText = (text || 'ART').trim().toUpperCase().slice(0, 10) || 'ART';
    if (cleanText === cachedTextString && cachedTextPoints.length > 0) {
        return cachedTextPoints;
    }

    const cw = 640;
    const ch = 260;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = cw;
    offCanvas.height = ch;
    const ctx = offCanvas.getContext('2d');

    ctx.clearRect(0, 0, cw, ch);
    const fontSize = Math.min(170, Math.floor((cw * 1.15) / Math.max(1.8, cleanText.length)));
    ctx.font = `900 ${fontSize}px "Google Sans", -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cleanText, cw / 2, ch / 2);

    const imgData = ctx.getImageData(0, 0, cw, ch).data;
    const rawEdges = [];
    let minX = cw, maxX = 0, minY = ch, maxY = 0;

    // Extract contour pixels (opaque pixel with at least one transparent neighbor)
    const step = 2;
    for (let y = step; y < ch - step; y += step) {
        for (let x = step; x < cw - step; x += step) {
            const idx = (y * cw + x) * 4 + 3;
            if (imgData[idx] > 128) {
                const top = imgData[((y - step) * cw + x) * 4 + 3];
                const bottom = imgData[((y + step) * cw + x) * 4 + 3];
                const left = imgData[(y * cw + (x - step)) * 4 + 3];
                const right = imgData[(y * cw + (x + step)) * 4 + 3];
                if (top <= 128 || bottom <= 128 || left <= 128 || right <= 128) {
                    rawEdges.push({ x, y });
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
    }

    if (rawEdges.length === 0) {
        cachedTextString = cleanText;
        cachedTextPoints = [{ x: 0, y: 0 }];
        return cachedTextPoints;
    }

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const centerX = minX + bboxW / 2;
    const centerY = minY + bboxH / 2;
    const maxDim = Math.max(bboxW, bboxH);

    // Normalize and order points smoothly via nearest-neighbor chaining for clean flow
    const normalized = rawEdges.map(pt => ({
        x: (pt.x - centerX) / maxDim,
        y: (pt.y - centerY) / maxDim
    }));

    // Downsample to ~220 evenly spaced points
    const targetCount = Math.min(220, normalized.length);
    const strided = [];
    const stride = normalized.length / targetCount;
    for (let i = 0; i < targetCount; i++) {
        strided.push(normalized[Math.floor(i * stride)]);
    }

    // Order points by nearest neighbor so items travel smoothly along letter strokes
    const ordered = [strided[0]];
    const used = new Uint8Array(strided.length);
    used[0] = 1;

    for (let i = 1; i < strided.length; i++) {
        const last = ordered[ordered.length - 1];
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let j = 0; j < strided.length; j++) {
            if (used[j]) continue;
            const dx = strided[j].x - last.x;
            const dy = strided[j].y - last.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDist) {
                bestDist = d2;
                bestIdx = j;
            }
        }
        if (bestIdx !== -1) {
            used[bestIdx] = 1;
            ordered.push(strided[bestIdx]);
        }
    }

    cachedTextString = cleanText;
    cachedTextPoints = ordered;
    return cachedTextPoints;
}

/**
 * Compute (x, y) coordinates on a parametric or custom shape curve.
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
        case 'butterfly': {
            // Temple H. Fay butterfly curve
            const r = (Math.exp(Math.sin(t)) - 2 * Math.cos(4 * t) + Math.pow(Math.sin((2 * t - Math.PI) / 24), 5)) * 0.32;
            x = baseSize * r * Math.cos(t);
            y = -baseSize * r * Math.sin(t);
            break;
        }
        case 'lissajous': {
            x = baseSize * 1.15 * Math.sin(3 * t + Math.PI / 2);
            y = baseSize * 0.95 * Math.sin(2 * t);
            break;
        }
        case 'spiral': {
            const norm = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
            const turns = 2.75 * Math.PI * 2;
            const angle = norm * turns;
            const r = (0.18 + 0.92 * norm) * baseSize;
            x = r * Math.cos(angle);
            y = r * Math.sin(angle);
            break;
        }
        case 'text': {
            const pts = generateTextShapePoints(config.customText);
            if (pts && pts.length > 0) {
                const percent = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
                const idx = Math.floor(percent * pts.length);
                const pt = pts[idx % pts.length];
                const textBase = Math.min(vw * 0.82, Math.max(vw, vh) * 0.68) * config.spread;
                x = pt.x * textBase;
                y = pt.y * textBase;
            }
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

    if (config.shape === 'text') {
        const pts = generateTextShapePoints(config.customText);
        const textBase = Math.min(vw * 0.82, Math.max(vw, vh) * 0.68) * config.spread;
        let d = '';
        for (let i = 0; i < pts.length; i++) {
            const px = cx + pts[i].x * textBase;
            const py = cy + pts[i].y * textBase;
            if (i === 0) {
                d += `M ${px} ${py}`;
            } else {
                const prevX = cx + pts[i - 1].x * textBase;
                const prevY = cy + pts[i - 1].y * textBase;
                const dist = Math.hypot(px - prevX, py - prevY);
                d += dist > 38 ? ` M ${px} ${py}` : ` L ${px} ${py}`;
            }
        }
        DOM.shapePath.setAttribute('d', d);
        return;
    }

    const numPoints = 180;
    const points = new Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        const pt = getShapeCoordinates(config.shape, t, vw, vh);
        points[i] = `${cx + pt.x},${cy + pt.y}`;
    }

    const closeCmd = config.shape === 'spiral' ? '' : ' Z';
    DOM.shapePath.setAttribute('d', 'M ' + points.join(' L ') + closeCmd);
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
    toggleShapeTextVisibility();
    saveConfigToStorage();
}

/** Ensure the "Custom" option exists in both native and styled dropdowns */
function ensureCustomOptionInDropdown() {
    let customOpt = Array.from(DOM.controlShape.options).find(opt => opt.value === 'custom');
    if (!customOpt) {
        customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = 'Custom (Perso)';
        DOM.controlShape.appendChild(customOpt);
    }
    customOpt.selected = true;

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

/** Show/hide the text word input when shape === 'text' */
function toggleShapeTextVisibility() {
    if (!DOM.controlShapeText) return;
    DOM.controlShapeText.style.display = (config.mode === 'shape' && config.shape === 'text') ? 'block' : 'none';
}

/** Show/hide the shape selector based on current mode */
function toggleShapeSelectorVisibility() {
    if (config.mode === 'shape') {
        DOM.shapeSelectorSection.style.display = 'flex';
        toggleShapeTextVisibility();
        updateShapeOverlayPath();
    } else {
        DOM.shapeSelectorSection.style.display = 'none';
        if (DOM.shapeOverlay) DOM.shapeOverlay.style.display = 'none';
    }
}


// ============================================================
//  SECTION 4 — Media Element Management (Images & Videos)
// ============================================================

/** Update the media counter badge in the settings panel */
function updateMediaCountBadge() {
    if (DOM.mediaCountBadge) {
        DOM.mediaCountBadge.textContent = String(mediaItems.length);
    }
}

/**
 * Create a collage media element from an image or video source URL.
 * @param {string} src - Media source (blob URL or HTTP URL)
 * @param {Object} [options] - Optional metadata ({ isVideo, dbId, objectUrl })
 * @returns {Object} The created item state object
 */
function createMediaElement(src, options = {}) {
    const isVideo = Boolean(options.isVideo);
    const container = document.createElement('div');
    container.className = 'collage-item';

    let el;
    if (isVideo) {
        el = document.createElement('video');
        el.autoplay = true;
        el.loop = true;
        el.muted = true;
        el.playsInline = true;
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        el.crossOrigin = 'anonymous';
        el.src = src;
    } else {
        el = document.createElement('img');
        el.crossOrigin = 'anonymous';
        el.src = src;
    }

    const item = {
        element: container,
        media: el,
        src,
        isVideo,
        dbId: options.dbId ?? null,
        objectUrl: options.objectUrl ?? null,
        baseWidth: 280,
        baseHeight: 380,
        x: 0, y: 0, z: 0,
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        dz: (Math.random() - 0.5) * 1.5,
        orbitAngle: 0,
        orbitSpeedFactor: 0.8 + Math.random() * 0.4,
        seed: Math.random() * 100,
        noiseOffset: Math.random() * Math.PI * 2,
        renderX: 0,
        renderY: 0,
        renderZ: 0,
        renderScale: 1,
        renderRotY: 0,
        renderRotZ: 0
    };

    if (isVideo) {
        el.onloadedmetadata = () => {
            const aspect = (el.videoWidth || 320) / (el.videoHeight || 240);
            setMediaDimensions(item, aspect);
            el.play().catch(() => {});
        };
        el.onerror = () => {
            if (el.crossOrigin) {
                el.removeAttribute('crossorigin');
                el.src = src;
            }
        };
        const badge = document.createElement('span');
        badge.className = 'item-video-badge';
        badge.textContent = 'VIDEO';
        container.appendChild(badge);
    } else {
        el.onload = () => {
            const aspect = el.naturalWidth / el.naturalHeight;
            setMediaDimensions(item, aspect);
        };
        // Graceful fallback if external URL server rejects anonymous CORS
        el.onerror = () => {
            if (el.crossOrigin) {
                el.removeAttribute('crossorigin');
                el.src = src;
            }
        };
    }

    // Quick delete button on card hover
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'item-delete-btn';
    deleteBtn.title = 'Remove this item';
    deleteBtn.setAttribute('aria-label', 'Remove item');
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeMediaItem(item);
    });

    // Click on card opens Lightbox inspector
    container.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(item);
    });

    container.appendChild(el);
    container.appendChild(deleteBtn);
    DOM.artboard.appendChild(container);

    // Default inline dimensions while loading
    container.style.width = '280px';
    container.style.height = '380px';
    container.style.marginLeft = '-140px';
    container.style.marginTop = '-190px';

    mediaItems.push(item);
    updateMediaCountBadge();
    distributeElements();
    return item;
}

/**
 * Set proper dimensions based on natural aspect ratio.
 * @param {Object} item
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
 * Remove a single media item from DOM, memory, and IndexedDB.
 * @param {Object} item
 */
function removeMediaItem(item) {
    if (!item) return;
    if (item.element) item.element.remove();
    if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
    }
    if (item.dbId !== null && item.dbId !== undefined) {
        deleteMediaFromDB(item.dbId);
    }
    const idx = mediaItems.indexOf(item);
    if (idx !== -1) {
        mediaItems.splice(idx, 1);
    }
    updateMediaCountBadge();
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

    let leftCount = 0, rightCount = 0;
    let topCount = 0, bottomCount = 0;
    const gridCols = [0, 0, 0];

    let cols = n <= 3 ? n : (n <= 6 ? 3 : 4);
    const rows = Math.ceil(n / cols);
    const gridWidth = (cols - 1) * ANIM.GRID_COL_SPACING;
    const gridHeight = (rows - 1) * ANIM.GRID_ROW_SPACING;

    // Golden ratio for Fibonacci Sphere
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    mediaItems.forEach((item, i) => {
        item.orbitAngle = (i * 2 * Math.PI) / n;
        item.shapeAngle = (i * 2 * Math.PI) / n;

        // Fibonacci sphere angles
        const ySphere = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
        item.spherePhi = Math.acos(clamp(ySphere, -1, 1));
        item.sphereTheta = goldenAngle * i;

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
            item.anchorX = -vw * 0.45 + (i / Math.max(1, n - 1)) * vw * 0.9;
            item.pendulumLength = vh * (0.32 + 0.25 * ((i * 7) % 5) / 5);
            item.pendulumPhase = i * 0.85;
            item.pendulumMaxAngle = 0.16 + (i % 3) * 0.05;
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

        // Assemble & Wave grid coordinates
        const cIdx = i % cols;
        const rIdx = Math.floor(i / cols);
        item.gridCol = cIdx;
        item.gridRow = rIdx;
        item.gridColsTotal = cols;
        item.gridRowsTotal = rows;
        item.targetGridX = cIdx * ANIM.GRID_COL_SPACING - gridWidth / 2;
        item.targetGridY = rIdx * ANIM.GRID_ROW_SPACING - gridHeight / 2;
    });

    trackCounts.left = leftCount;
    trackCounts.right = rightCount;
    trackCounts.top = topCount;
    trackCounts.bottom = bottomCount;
    trackCounts.col0 = gridCols[0];
    trackCounts.col1 = gridCols[1];
    trackCounts.col2 = gridCols[2];
}

/** Remove all media items from the canvas and revoke ObjectURLs */
function clearAllMedia() {
    mediaItems.forEach(item => {
        if (item.element) item.element.remove();
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    mediaItems = [];
    updateMediaCountBadge();
}


// ============================================================
//  SECTION 5 — Animation Engine (15 Modes + 3D Parallax)
// ============================================================

/**
 * Main animation loop. Updates all item positions each frame.
 */
function animate(now = performance.now()) {
    const dt = Math.min(0.1, (now - lastFrameTime) * 0.001);
    lastFrameTime = now;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mode = config.mode;
    const speed = config.paused ? 0 : config.speed;
    const scale = config.scale;
    const spread = config.spread;

    if (!config.paused) {
        animTime += dt;
        scrollOffset += 1.5 * speed;
    }
    const time = animTime;

    // Smooth 3D Parallax update on perspective-origin
    if (config.parallax) {
        parallaxState.currentX = lerp(parallaxState.currentX, parallaxState.targetX, 0.08);
        parallaxState.currentY = lerp(parallaxState.currentY, parallaxState.targetY, 0.08);
        const originX = 50 + parallaxState.currentX * 22;
        const originY = 50 + parallaxState.currentY * 22;
        DOM.artboard.style.perspectiveOrigin = `${originX.toFixed(2)}% ${originY.toFixed(2)}%`;
    } else {
        DOM.artboard.style.perspectiveOrigin = '50% 50%';
    }

    const marginX = vw * 0.35;
    const marginY = vh * 0.35;
    const minZ = ANIM.DRIFT_Z_MIN;
    const maxZ = ANIM.DRIFT_Z_MAX;

    const numLeft = trackCounts.left;
    const numRight = trackCounts.right;
    const numTop = trackCounts.top;
    const numBottom = trackCounts.bottom;
    const numCol0 = trackCounts.col0;
    const numCol1 = trackCounts.col1;
    const numCol2 = trackCounts.col2;
    const totalItems = mediaItems.length;

    for (let idx = 0; idx < totalItems; idx++) {
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
                if (!config.paused) {
                    item.x += Math.sin(time + item.seed) * 0.2;
                    item.y += Math.cos(time + item.seed) * 0.2;
                }

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

                const omega = 1.6 * (config.paused ? config.speed : speed);
                const theta = item.pendulumMaxAngle * Math.sin(omega * time + item.pendulumPhase);

                x = item.anchorX * spread + Math.sin(theta) * item.pendulumLength;
                y = -vh * 0.42 + Math.cos(theta) * item.pendulumLength;
                z = Math.sin(time + item.seed) * 45;

                // Planar pendulum rotation around Z axis (in degrees)
                item.pendulumAngle = -theta * (180 / Math.PI) * 0.85;
                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'helix': {
                // Double 3D DNA Helix
                const strand = idx % 2;
                const pairIdx = Math.floor(idx / 2);
                const pairsTotal = Math.max(1, Math.ceil(totalItems / 2));
                const normY = pairsTotal === 1 ? 0 : (pairIdx / (pairsTotal - 1)) - 0.5;
                const helixAngle = time * 1.1 * config.speed + normY * Math.PI * 2.4 + strand * Math.PI;
                const radiusX = vw * 0.26 * spread;
                const radiusZ = 260 * spread;

                x = Math.cos(helixAngle) * radiusX;
                y = normY * vh * 0.72 * spread;
                z = Math.sin(helixAngle) * radiusZ;
                item.helixAngle = helixAngle;
                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'wave': {
                // 3D Ocean Wave Field
                const cols = item.gridColsTotal || 3;
                const rows = item.gridRowsTotal || 3;
                const nx = cols === 1 ? 0 : (item.gridCol / (cols - 1)) - 0.5;
                const ny = rows === 1 ? 0 : (item.gridRow / (rows - 1)) - 0.5;
                const wavePhase = time * 1.8 * config.speed + nx * 3.2 + ny * 2.4;

                x = nx * vw * 0.62 * spread;
                y = ny * vh * 0.52 * spread + Math.sin(wavePhase) * 65 * spread;
                z = Math.cos(wavePhase) * 190 * spread;
                item.waveAngle = Math.cos(wavePhase) * 10;
                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'sphere': {
                // 3D Fibonacci Globe
                const radius = Math.min(vw, vh) * 0.36 * spread;
                const rotAngle = time * 0.55 * config.speed;
                const phi = item.spherePhi ?? Math.PI / 2;
                const theta = (item.sphereTheta ?? 0) + rotAngle;

                x = radius * Math.sin(phi) * Math.cos(theta);
                y = radius * Math.cos(phi);
                z = radius * Math.sin(phi) * Math.sin(theta);
                item.sphereThetaNow = theta;
                item.x = x; item.y = y; item.z = z;
                break;
            }
            case 'shape': {
                if (item.shapeAngle === undefined) {
                    item.shapeAngle = (idx * 2 * Math.PI) / Math.max(1, totalItems);
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
        else if (mode === 'sphere') { modeMinZ = ANIM.SPHERE_Z_MIN; modeMaxZ = ANIM.SPHERE_Z_MAX; }

        const normalizedDepth = clamp((z - modeMinZ) / (modeMaxZ - modeMinZ), 0, 1);
        const scaleFactor = (0.55 + normalizedDepth * 0.7) * scale;
        const zIndex = Math.round(normalizedDepth * 900) + 50;

        // Separate 3D Y-rotation and planar Z-rotation
        let rotY = 0;
        let rotZ = 0;
        switch (mode) {
            case 'orbit':
                rotY = Math.cos(item.orbitAngle) * -10;
                break;
            case 'drift':
                rotY = item.dx * 2.5;
                break;
            case 'assemble':
                rotY = (item.dx * 2.5) * (1 - (item.gatherWeight || 0));
                break;
            case 'vortex':
                rotZ = Math.sin(item.vortexAngle) * 6;
                rotY = Math.cos(item.vortexAngle) * -8;
                break;
            case 'pendulum':
                if (item.pendulumAngle !== undefined) rotZ = item.pendulumAngle;
                break;
            case 'helix':
                if (item.helixAngle !== undefined) rotY = Math.cos(item.helixAngle) * -14;
                break;
            case 'wave':
                if (item.waveAngle !== undefined) rotZ = item.waveAngle * 0.4;
                break;
            case 'sphere':
                if (item.sphereThetaNow !== undefined) rotY = Math.cos(item.sphereThetaNow) * -15;
                break;
            case 'shape':
                if (item.shapeAngle !== undefined) rotY = Math.cos(item.shapeAngle) * -8;
                break;
        }

        // Opacity: solid by default, soft fade for cinematic/vortex
        const finalOpacity = (mode === 'cinematic' || mode === 'vortex')
            ? (item.fadeOpacity !== undefined ? item.fadeOpacity : 1.0)
            : 1.0;

        // Cache render coordinates for canvas export & video recorder
        item.renderX = x;
        item.renderY = y;
        item.renderZ = z;
        item.renderScale = scaleFactor;
        item.renderRotY = rotY;
        item.renderRotZ = rotZ;
        item.renderOpacity = finalOpacity;

        // Single composite DOM write per item
        const el = item.element;
        el.style.zIndex = zIndex;
        el.style.opacity = finalOpacity;
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateY(${rotY.toFixed(2)}deg) rotateZ(${rotZ.toFixed(2)}deg) scale(${scaleFactor.toFixed(3)})`;
    }

    // If video recording is active, render current frame onto recorder canvas
    if (isRecordingVideo && recorderCtx && recorderCanvas) {
        renderCollageToCanvas(recorderCtx, recorderCanvas.width, recorderCanvas.height, recorderDpr);
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

/**
 * Save a media file (Blob or URL string) to IndexedDB.
 * @param {Blob|string} file
 * @param {boolean} isVideo
 * @param {function(number):void} [onSaved] - Callback receiving the generated record ID
 */
function saveMediaToDB(file, isVideo = false, onSaved = null) {
    if (!db) return;
    try {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const req = tx.objectStore(STORE_NAME).add({
            blob: file,
            isVideo: Boolean(isVideo),
            timestamp: Date.now()
        });
        req.onsuccess = (e) => {
            if (onSaved) onSaved(e.target.result);
        };
    } catch (err) {
        console.error('Failed to save media to database:', err);
    }
}

/** Delete a single media record by ID from IndexedDB */
function deleteMediaFromDB(id) {
    if (!db || id === null || id === undefined) return;
    try {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
    } catch (err) {
        console.error('Failed to delete media from database:', err);
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
                let url;
                let objectUrl = null;
                if (record.blob instanceof Blob) {
                    url = URL.createObjectURL(record.blob);
                    objectUrl = url;
                } else if (typeof record.blob === 'string') {
                    url = record.blob;
                } else {
                    return;
                }

                const mediaItem = createMediaElement(url, {
                    isVideo: Boolean(record.isVideo),
                    dbId: record.id,
                    objectUrl
                });
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
//  SECTION 7 — High-Res PNG Export & WebM Video Recording
// ============================================================

/** Helper to draw a rounded rectangle path on a 2D canvas context */
function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

/**
 * Render the current collage state onto any 2D canvas context.
 * Respects active theme background, card frame style, Z-order, and 3D rotations.
 */
function renderCollageToCanvas(ctx, width, height, dpr) {
    const bgColor = THEME_BG_COLORS[config.theme] || '#ffffff';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    const sortedItems = [...mediaItems].sort((a, b) => (a.renderZ ?? a.z) - (b.renderZ ?? b.z));
    const cx = width / 2;
    const cy = height / 2;
    const cardStyle = config.cardStyle;

    sortedItems.forEach((item) => {
        const rx = item.renderX ?? item.x;
        const ry = item.renderY ?? item.y;
        const rScale = item.renderScale ?? 1;
        const rotY = item.renderRotY ?? 0;
        const rotZ = item.renderRotZ ?? 0;
        const rOpacity = item.renderOpacity ?? 1.0;

        const w = item.baseWidth;
        const h = item.baseHeight;
        // 3D Y-rotation foreshortening factor
        const cosY = Math.cos((rotY * Math.PI) / 180);

        ctx.save();
        ctx.globalAlpha = rOpacity;
        ctx.translate(cx + rx * dpr, cy + ry * dpr);
        ctx.rotate((rotZ * Math.PI) / 180);
        ctx.scale(rScale * dpr * cosY, rScale * dpr);

        try {
            if (cardStyle === 'polaroid') {
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
                ctx.shadowBlur = 24;
                ctx.shadowOffsetY = 10;
                ctx.fillStyle = '#ffffff';
                roundRectPath(ctx, -w / 2 - 10, -h / 2 - 10, w + 20, h + 42, 4);
                ctx.fill();
                ctx.restore();
                ctx.drawImage(item.media, -w / 2, -h / 2, w, h);
            } else if (cardStyle === 'shadow') {
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
                ctx.shadowBlur = 28;
                ctx.shadowOffsetY = 12;
                ctx.fillStyle = bgColor;
                roundRectPath(ctx, -w / 2, -h / 2, w, h, 12);
                ctx.fill();
                ctx.restore();
                roundRectPath(ctx, -w / 2, -h / 2, w, h, 12);
                ctx.clip();
                ctx.drawImage(item.media, -w / 2, -h / 2, w, h);
            } else if (cardStyle === 'glass') {
                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1.5;
                roundRectPath(ctx, -w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 14);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
                roundRectPath(ctx, -w / 2, -h / 2, w, h, 9);
                ctx.clip();
                ctx.drawImage(item.media, -w / 2, -h / 2, w, h);
            } else {
                roundRectPath(ctx, -w / 2, -h / 2, w, h, 2);
                ctx.clip();
                ctx.drawImage(item.media, -w / 2, -h / 2, w, h);
            }
        } catch (e) {
            console.warn('Skipped non-CORS media element on canvas render:', e);
        }

        ctx.restore();
    });
}

/** Export the current collage as a 2x resolution PNG */
function exportCollageAsImage() {
    if (mediaItems.length === 0) return;

    const canvas = document.createElement('canvas');
    const dpr = 2;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    const ctx = canvas.getContext('2d');
    renderCollageToCanvas(ctx, canvas.width, canvas.height, dpr);

    try {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `collage-${config.mode}.png`;
        link.href = dataUrl;
        link.click();
    } catch (err) {
        console.error('Failed to export collage image:', err);
    }
}

// --- Real-Time Video Recorder (WebM) ---
let isRecordingVideo = false;
let mediaRecorder = null;
let recordedChunks = [];
let recorderCanvas = null;
let recorderCtx = null;
let recorderDpr = 1.5;
let recordStopTimer = null;

function toggleVideoRecording() {
    if (isRecordingVideo) {
        stopVideoRecording();
    } else {
        startVideoRecording();
    }
}

function startVideoRecording() {
    if (mediaItems.length === 0 || isRecordingVideo) return;
    if (typeof MediaRecorder === 'undefined') {
        alert('Video recording is not supported in this browser.');
        return;
    }

    // Ensure animation is playing while recording
    if (config.paused) {
        setPausedState(false);
    }

    recorderDpr = Math.min(2, window.devicePixelRatio || 1.5);
    recorderCanvas = document.createElement('canvas');
    recorderCanvas.width = Math.round(window.innerWidth * recorderDpr);
    recorderCanvas.height = Math.round(window.innerHeight * recorderDpr);
    recorderCtx = recorderCanvas.getContext('2d');

    const stream = recorderCanvas.captureStream(60);
    const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
    ];
    const supportedType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

    try {
        mediaRecorder = supportedType
            ? new MediaRecorder(stream, { mimeType: supportedType, videoBitsPerSecond: 8000000 })
            : new MediaRecorder(stream);
    } catch (err) {
        console.error('Failed to start MediaRecorder:', err);
        return;
    }

    recordedChunks = [];
    isRecordingVideo = true;

    DOM.controlRecord.classList.add('recording');
    DOM.controlRecord.textContent = '■ Stop Rec';
    updateStatusPill();

    mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
        }
    };

    mediaRecorder.onstop = () => {
        const ext = (mediaRecorder.mimeType && mediaRecorder.mimeType.includes('mp4')) ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `collage-${config.mode}.${ext}`;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    };

    mediaRecorder.start(100);

    // Automatically stop after 6 seconds if not stopped manually
    recordStopTimer = setTimeout(() => {
        if (isRecordingVideo) stopVideoRecording();
    }, 6000);
}

function stopVideoRecording() {
    if (!isRecordingVideo) return;
    isRecordingVideo = false;
    clearTimeout(recordStopTimer);

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    DOM.controlRecord.classList.remove('recording');
    DOM.controlRecord.textContent = 'Record Video';
    updateStatusPill();
}


// ============================================================
//  SECTION 8 — Interactive Lightbox & Sample Art Generator
// ============================================================

let currentLightboxIndex = -1;

function openLightbox(item) {
    const idx = mediaItems.indexOf(item);
    if (idx === -1) return;
    currentLightboxIndex = idx;
    renderLightboxItem();
    DOM.lightboxModal.classList.remove('hidden');
}

function closeLightbox() {
    DOM.lightboxModal.classList.add('hidden');
    DOM.lightboxMediaWrapper.innerHTML = '';
    currentLightboxIndex = -1;
}

function renderLightboxItem() {
    if (currentLightboxIndex < 0 || currentLightboxIndex >= mediaItems.length) {
        closeLightbox();
        return;
    }

    const item = mediaItems[currentLightboxIndex];
    DOM.lightboxMediaWrapper.innerHTML = '';

    if (item.isVideo) {
        const video = document.createElement('video');
        video.src = item.src;
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        DOM.lightboxMediaWrapper.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = item.src;
        img.alt = `Collage item ${currentLightboxIndex + 1}`;
        DOM.lightboxMediaWrapper.appendChild(img);
    }

    DOM.lightboxCounter.textContent = `${currentLightboxIndex + 1} / ${mediaItems.length}`;
}

function navigateLightbox(delta) {
    if (mediaItems.length === 0) return;
    currentLightboxIndex = (currentLightboxIndex + delta + mediaItems.length) % mediaItems.length;
    renderLightboxItem();
}

if (DOM.lightboxBackdrop) DOM.lightboxBackdrop.addEventListener('click', closeLightbox);
if (DOM.lightboxClose) DOM.lightboxClose.addEventListener('click', closeLightbox);
if (DOM.lightboxPrev) DOM.lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
if (DOM.lightboxNext) DOM.lightboxNext.addEventListener('click', () => navigateLightbox(1));

if (DOM.lightboxDownload) {
    DOM.lightboxDownload.addEventListener('click', () => {
        if (currentLightboxIndex < 0 || currentLightboxIndex >= mediaItems.length) return;
        const item = mediaItems[currentLightboxIndex];
        const a = document.createElement('a');
        a.href = item.src;
        a.download = item.isVideo ? `media-${currentLightboxIndex + 1}.mp4` : `media-${currentLightboxIndex + 1}.png`;
        a.click();
    });
}

if (DOM.lightboxDelete) {
    DOM.lightboxDelete.addEventListener('click', () => {
        if (currentLightboxIndex < 0 || currentLightboxIndex >= mediaItems.length) return;
        const item = mediaItems[currentLightboxIndex];
        removeMediaItem(item);
        if (mediaItems.length === 0) {
            closeLightbox();
        } else {
            currentLightboxIndex %= mediaItems.length;
            renderLightboxItem();
        }
    });
}

/**
 * Generate 8 high-aesthetic procedural minimalist art cards and load them into the collage.
 */
function loadSampleArt() {
    hideIntroHint();

    const palettes = [
        { bg: '#f4efe6', fg: '#1d1d1b', accent: '#d9534f', shape: 'circle-bauhaus' },
        { bg: '#16181d', fg: '#f5f2eb', accent: '#e6b800', shape: 'arch' },
        { bg: '#e8edf2', fg: '#1e293b', accent: '#2563eb', shape: 'swiss-grid' },
        { bg: '#2b2118', fg: '#f7f3e9', accent: '#e07a5f', shape: 'sun-horizon' },
        { bg: '#f0ece1', fg: '#111111', accent: '#2a9d8f', shape: 'concentric' },
        { bg: '#111625', fg: '#e2e8f0', accent: '#f4a261', shape: 'moon-phase' },
        { bg: '#ebe5d9', fg: '#222222', accent: '#c1121f', shape: 'diagonal-split' },
        { bg: '#1f2421', fg: '#dce1de', accent: '#8ac926', shape: 'minimal-wave' }
    ];

    palettes.forEach((p, idx) => {
        const isLandscape = idx % 3 === 0;
        const cw = isLandscape ? 720 : 540;
        const ch = isLandscape ? 520 : 720;

        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d');

        // Background
        ctx.fillStyle = p.bg;
        ctx.fillRect(0, 0, cw, ch);

        // Generative minimalist artwork
        ctx.save();
        if (p.shape === 'circle-bauhaus') {
            ctx.fillStyle = p.accent;
            ctx.beginPath();
            ctx.arc(cw * 0.5, ch * 0.45, Math.min(cw, ch) * 0.3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = p.fg;
            ctx.fillRect(cw * 0.2, ch * 0.62, cw * 0.6, 18);
            ctx.fillRect(cw * 0.2, ch * 0.68, cw * 0.38, 8);
        } else if (p.shape === 'arch') {
            ctx.fillStyle = p.accent;
            ctx.beginPath();
            ctx.arc(cw * 0.5, ch * 0.45, cw * 0.28, Math.PI, 0);
            ctx.lineTo(cw * 0.78, ch * 0.82);
            ctx.lineTo(cw * 0.22, ch * 0.82);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = p.fg;
            ctx.beginPath();
            ctx.arc(cw * 0.5, ch * 0.35, 34, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.shape === 'swiss-grid') {
            ctx.fillStyle = p.accent;
            ctx.fillRect(cw * 0.12, ch * 0.12, cw * 0.36, ch * 0.36);
            ctx.fillStyle = p.fg;
            ctx.fillRect(cw * 0.52, ch * 0.12, cw * 0.36, ch * 0.76);
            ctx.beginPath();
            ctx.arc(cw * 0.3, ch * 0.68, cw * 0.16, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.shape === 'sun-horizon') {
            ctx.fillStyle = p.accent;
            ctx.beginPath();
            ctx.arc(cw * 0.5, ch * 0.52, Math.min(cw, ch) * 0.26, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = p.bg;
            for (let i = 0; i < 6; i++) {
                ctx.fillRect(0, ch * 0.55 + i * 24, cw, 10 + i * 2);
            }
        } else if (p.shape === 'concentric') {
            ctx.strokeStyle = p.fg;
            ctx.lineWidth = 14;
            for (let r = 40; r <= 200; r += 40) {
                ctx.beginPath();
                ctx.arc(cw * 0.5, ch * 0.5, r, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.fillStyle = p.accent;
            ctx.beginPath();
            ctx.arc(cw * 0.5, ch * 0.5, 28, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.shape === 'moon-phase') {
            ctx.fillStyle = p.fg;
            ctx.beginPath();
            ctx.arc(cw * 0.46, ch * 0.48, 130, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = p.bg;
            ctx.beginPath();
            ctx.arc(cw * 0.55, ch * 0.44, 110, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = p.accent;
            ctx.beginPath();
            ctx.arc(cw * 0.66, ch * 0.32, 22, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.shape === 'diagonal-split') {
            ctx.fillStyle = p.fg;
            ctx.beginPath();
            ctx.moveTo(0, ch);
            ctx.lineTo(cw, ch * 0.25);
            ctx.lineTo(cw, ch);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = p.accent;
            ctx.beginPath();
            ctx.arc(cw * 0.35, ch * 0.36, 75, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.strokeStyle = p.accent;
            ctx.lineWidth = 18;
            ctx.lineCap = 'round';
            for (let row = -2; row <= 2; row++) {
                ctx.beginPath();
                for (let x = 60; x <= cw - 60; x += 10) {
                    const y = ch * 0.5 + row * 55 + Math.sin(x * 0.02 + row) * 28;
                    if (x === 60) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
        }
        ctx.restore();

        c.toBlob((blob) => {
            if (!blob) return;
            const objectUrl = URL.createObjectURL(blob);
            saveMediaToDB(blob, false, (dbId) => {
                const item = createMediaElement(objectUrl, { isVideo: false, dbId, objectUrl });
                item.x = (Math.random() - 0.5) * window.innerWidth * 0.55;
                item.y = (Math.random() - 0.5) * window.innerHeight * 0.55;
                item.z = (Math.random() - 0.5) * 300;
            });
        }, 'image/png');
    });
}


// ============================================================
//  SECTION 9 — UI Controllers & Event Bindings
// ============================================================

/** Update the top status pill (Paused / Recording) */
function updateStatusPill() {
    if (!DOM.statusPill || !DOM.statusText) return;

    if (isRecordingVideo) {
        DOM.statusPill.classList.remove('hidden');
        DOM.statusPill.classList.add('recording');
        DOM.statusText.textContent = 'Recording 60fps Video...';
    } else if (config.paused) {
        DOM.statusPill.classList.remove('hidden');
        DOM.statusPill.classList.remove('recording');
        DOM.statusText.textContent = 'Paused (Press Space to resume)';
    } else {
        DOM.statusPill.classList.add('hidden');
        DOM.statusPill.classList.remove('recording');
    }
}

/** Set pause state and sync UI */
function setPausedState(paused) {
    config.paused = Boolean(paused);
    if (DOM.controlPause) {
        DOM.controlPause.classList.toggle('active', config.paused);
        DOM.controlPause.setAttribute('aria-pressed', String(config.paused));
    }
    if (DOM.pauseIcon) {
        DOM.pauseIcon.textContent = config.paused ? '▶' : '⏸';
    }
    updateStatusPill();
}

/** Set 3D Parallax state and sync UI */
function setParallaxState(enabled) {
    config.parallax = Boolean(enabled);
    if (DOM.controlParallax) {
        DOM.controlParallax.classList.toggle('active', config.parallax);
        DOM.controlParallax.setAttribute('aria-pressed', String(config.parallax));
    }
    saveConfigToStorage();
}

/** Apply theme (`light`, `warm`, `gray`, `dark`, `midnight`) */
function applyTheme(themeName) {
    const validTheme = THEME_BG_COLORS[themeName] ? themeName : 'light';
    config.theme = validTheme;
    document.documentElement.setAttribute('data-theme', validTheme);
    if (DOM.metaThemeColor) {
        DOM.metaThemeColor.setAttribute('content', THEME_BG_COLORS[validTheme]);
    }
    DOM.themeSwatches.forEach(swatch => {
        swatch.classList.toggle('active', swatch.getAttribute('data-theme-val') === validTheme);
    });
    saveConfigToStorage();
}

/** Apply card frame style (`minimal`, `shadow`, `polaroid`, `glass`) */
function applyCardStyle(styleName) {
    config.cardStyle = styleName || 'minimal';
    document.body.setAttribute('data-card-style', config.cardStyle);
    if (DOM.controlCardStyle) {
        DOM.controlCardStyle.value = config.cardStyle;
    }
    syncCustomDropdown(DOM.controlCardStyle, DOM.customCardSelect);
    saveConfigToStorage();
}

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
        setTimeout(() => {
            if (DOM.introHint) DOM.introHint.style.display = 'none';
        }, 450);
    }
}

// --- Sample Art button ---
if (DOM.loadSamplesBtn) {
    DOM.loadSamplesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadSampleArt();
    });
}

// --- Keyboard shortcuts ---
window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

    // Lightbox keyboard handling
    if (DOM.lightboxModal && !DOM.lightboxModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeLightbox();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateLightbox(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateLightbox(1);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            DOM.lightboxDelete.click();
        }
        return;
    }

    if (isTyping) {
        if (e.key === 'Escape') document.activeElement.blur();
        return;
    }

    if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') {
        toggleSettings();
    } else if (e.key === ' ') {
        e.preventDefault();
        setPausedState(!config.paused);
    } else if (e.key === 'p' || e.key === 'P') {
        setParallaxState(!config.parallax);
    }
});

// --- 3D Mouse & Gyroscope Parallax Listeners ---
window.addEventListener('mousemove', (e) => {
    if (!config.parallax) return;
    parallaxState.targetX = (e.clientX / window.innerWidth - 0.5) * 2;
    parallaxState.targetY = (e.clientY / window.innerHeight - 0.5) * 2;
}, { passive: true });

window.addEventListener('deviceorientation', (e) => {
    if (!config.parallax || e.gamma === null || e.beta === null) return;
    parallaxState.targetX = clamp(e.gamma / 30, -1, 1);
    parallaxState.targetY = clamp((e.beta - 45) / 30, -1, 1);
}, { passive: true });

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
    if (e.target === DOM.artboard) {
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

    if (dist < 12 && duration < 300) {
        if (e.target === DOM.artboard) {
            toggleSettings();
        }
    }
}, { passive: true });

DOM.artboard.addEventListener('click', (e) => {
    if (e.target === DOM.artboard) {
        toggleSettings();
    }
});

// --- Generic Custom Select Sync Helper ---
function syncCustomDropdown(selectEl, customContainer) {
    if (!selectEl || !customContainer) return;
    const val = selectEl.value;
    const trigger = customContainer.querySelector('.custom-select-trigger');
    const selectedOption = customContainer.querySelector(`.custom-option[data-value="${val}"]`);

    if (selectedOption) {
        if (trigger) trigger.textContent = selectedOption.textContent;
        customContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
        selectedOption.classList.add('selected');
    }
}

function syncCustomModeDropdown() {
    syncCustomDropdown(DOM.controlMode, DOM.customModeSelect);
}

function syncCustomShapeDropdown() {
    syncCustomDropdown(DOM.controlShape, DOM.customShapeSelect);
}

function closeAllCustomDropdowns(except = null) {
    [DOM.customModeSelect, DOM.customShapeSelect, DOM.customCardSelect].forEach(dd => {
        if (dd && dd !== except) dd.classList.remove('open');
    });
}

// --- Mode change ---
DOM.controlMode.addEventListener('change', (e) => {
    config.mode = e.target.value;
    distributeElements();
    syncCustomModeDropdown();
    toggleShapeSelectorVisibility();
    saveConfigToStorage();
});

// --- Setup Custom Dropdowns (Mode, Shape, Card Style) ---
function setupCustomDropdown(selectEl, customContainer) {
    if (!selectEl || !customContainer) return;
    const trigger = customContainer.querySelector('.custom-select-trigger');
    if (trigger) {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllCustomDropdowns(customContainer);
            customContainer.classList.toggle('open');
        });
    }
    customContainer.querySelectorAll('.custom-option').forEach(opt => {
        opt.onclick = () => {
            selectEl.value = opt.getAttribute('data-value');
            selectEl.dispatchEvent(new Event('change'));
            customContainer.classList.remove('open');
        };
    });
}

setupCustomDropdown(DOM.controlMode, DOM.customModeSelect);
setupCustomDropdown(DOM.controlShape, DOM.customShapeSelect);
setupCustomDropdown(DOM.controlCardStyle, DOM.customCardSelect);

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
        toggleShapeTextVisibility();
        updateShapeOverlayPath();
        syncCustomShapeDropdown();
        saveConfigToStorage();
    }
});

// --- Text Path word input ---
if (DOM.controlShapeText) {
    DOM.controlShapeText.addEventListener('input', (e) => {
        config.customText = e.target.value || 'ART';
        updateShapeOverlayPath();
        saveConfigToStorage();
    });
}

// --- Card frame style change ---
if (DOM.controlCardStyle) {
    DOM.controlCardStyle.addEventListener('change', (e) => {
        applyCardStyle(e.target.value);
    });
}

// --- Theme swatches ---
DOM.themeSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
        applyTheme(swatch.getAttribute('data-theme-val'));
    });
});

// --- Scene Toggles (Pause & 3D Parallax) ---
if (DOM.controlPause) {
    DOM.controlPause.addEventListener('click', () => setPausedState(!config.paused));
}
if (DOM.controlParallax) {
    DOM.controlParallax.addEventListener('click', () => setParallaxState(!config.parallax));
}

// --- Close dropdowns on outside click ---
window.addEventListener('click', () => {
    closeAllCustomDropdowns();
});

// --- Parameter sliders ---
DOM.controlSpeed.addEventListener('input', (e) => {
    config.speed = parseFloat(e.target.value);
    saveConfigToStorage();
});
DOM.controlScale.addEventListener('input', (e) => {
    config.scale = parseFloat(e.target.value);
    saveConfigToStorage();
});
DOM.controlSpread.addEventListener('input', (e) => {
    config.spread = parseFloat(e.target.value);
    updateShapeOverlayPath();
    saveConfigToStorage();
});

// --- Action buttons ---
DOM.controlClear.addEventListener('click', () => {
    clearAllMedia();
    clearMediaDB();
});

DOM.controlReset.addEventListener('click', () => {
    clearAllMedia();
    clearMediaDB();

    Object.assign(config, DEFAULT_CONFIG);
    setPausedState(false);

    DOM.controlMode.value = config.mode;
    DOM.controlSpeed.value = config.speed;
    DOM.controlScale.value = config.scale;
    DOM.controlSpread.value = config.spread;
    DOM.controlShape.value = config.shape;
    if (DOM.controlShapeText) DOM.controlShapeText.value = config.customText;

    // Clean up injected custom option
    const customOpt = Array.from(DOM.controlShape.options).find(opt => opt.value === 'custom');
    if (customOpt) customOpt.remove();
    const customDivOpt = DOM.customShapeSelect.querySelector('.custom-option[data-value="custom"]');
    if (customDivOpt) customDivOpt.remove();
    setupCustomDropdown(DOM.controlShape, DOM.customShapeSelect);

    applyTheme(config.theme);
    applyCardStyle(config.cardStyle);
    setParallaxState(config.parallax);
    syncCustomModeDropdown();
    syncCustomShapeDropdown();
    toggleShapeSelectorVisibility();
    saveConfigToStorage();
});

DOM.controlExport.addEventListener('click', exportCollageAsImage);
if (DOM.controlRecord) {
    DOM.controlRecord.addEventListener('click', toggleVideoRecording);
}

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
//  SECTION 10 — Interactive Custom Drawing Canvas
// ============================================================

function startInteractiveDrawing() {
    DOM.drawingOverlay.style.display = 'flex';
    DOM.drawingCanvas.width = window.innerWidth;
    DOM.drawingCanvas.height = window.innerHeight;

    drawingCtx = DOM.drawingCanvas.getContext('2d');
    const isDark = config.theme === 'dark' || config.theme === 'midnight';
    drawingCtx.strokeStyle = isDark ? '#f3f4f6' : '#111111';
    drawingCtx.lineWidth = 3.5;
    drawingCtx.lineCap = 'round';
    drawingCtx.lineJoin = 'round';
    drawingCtx.shadowColor = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)';
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
//  SECTION 11 — SVG & Media File / URL Import Handlers
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

/**
 * Process dropped/selected image or video files.
 * @param {FileList} files
 */
function handleFiles(files) {
    if (!files || files.length === 0) return;
    hideIntroHint();

    Array.from(files).forEach((file) => {
        const isImg = file.type.startsWith('image/');
        const isVid = file.type.startsWith('video/');
        if (!isImg && !isVid) return;

        const objectUrl = URL.createObjectURL(file);
        saveMediaToDB(file, isVid, (dbId) => {
            const item = createMediaElement(objectUrl, {
                isVideo: isVid,
                dbId,
                objectUrl
            });

            const rangeX = window.innerWidth * 0.5;
            const rangeY = window.innerHeight * 0.5;
            item.x = (Math.random() - 0.5) * rangeX;
            item.y = (Math.random() - 0.5) * rangeY;
            item.z = (Math.random() - 0.5) * 300;
            item.orbitAngle = Math.random() * Math.PI * 2;
        });
    });
}

/**
 * Process an image, GIF, or video URL input.
 * @param {string} url
 */
function handleURL(url) {
    if (!url) return;
    url = url.trim();
    if (url === "") return;

    hideIntroHint();

    const isVideoExt = /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);

    const addMedia = (src, blobOrUrlToSave, isVid, objectUrl = null) => {
        saveMediaToDB(blobOrUrlToSave, isVid, (dbId) => {
            const item = createMediaElement(src, { isVideo: isVid, dbId, objectUrl });
            const rangeX = window.innerWidth * 0.5;
            const rangeY = window.innerHeight * 0.5;
            item.x = (Math.random() - 0.5) * rangeX;
            item.y = (Math.random() - 0.5) * rangeY;
            item.z = (Math.random() - 0.5) * 300;
            item.orbitAngle = Math.random() * Math.PI * 2;
        });
    };

    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.blob();
        })
        .then(blob => {
            const isImg = blob.type.startsWith('image/');
            const isVid = blob.type.startsWith('video/') || isVideoExt;
            if (!isImg && !isVid) {
                alert('Only image, GIF, or video (MP4/WebM) URLs are supported.');
                return;
            }
            const localUrl = URL.createObjectURL(blob);
            addMedia(localUrl, blob, isVid, localUrl);
            DOM.controlUrlInput.value = "";
        })
        .catch(err => {
            console.warn('CORS or network error fetching URL as blob. Falling back to direct URL load:', err);
            addMedia(url, url, isVideoExt, null);
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
DOM.controlUpload.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = "";
});

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

    if (Math.abs(deltaY) > 50 && elapsed < 400) {
        if (deltaY > 50 && DOM.settingsPanel.classList.contains('hidden') && gestureStartY > window.innerHeight * 0.5) {
            DOM.settingsPanel.classList.remove('hidden');
            hideIntroHint();
            if (DOM.mobileSettingsBtn) DOM.mobileSettingsBtn.classList.add('panel-open');
        } else if (deltaY < -50 && !DOM.settingsPanel.classList.contains('hidden') && gestureStartY < window.innerHeight * 0.45) {
            DOM.settingsPanel.classList.add('hidden');
            if (DOM.mobileSettingsBtn) DOM.mobileSettingsBtn.classList.remove('panel-open');
        }
    }

    gestureStartY = 0;
}, { passive: true });


// ============================================================
//  SECTION 13 — Boot Sequence
// ============================================================

loadConfigFromStorage();

// Sync DOM controls with loaded configuration
if (config.shape === 'custom' && config.customShapePoints) {
    ensureCustomOptionInDropdown();
}
DOM.controlMode.value = config.mode;
DOM.controlSpeed.value = config.speed;
DOM.controlScale.value = config.scale;
DOM.controlSpread.value = config.spread;
DOM.controlShape.value = config.shape;
if (DOM.controlShapeText) DOM.controlShapeText.value = config.customText;

applyTheme(config.theme);
applyCardStyle(config.cardStyle);
setParallaxState(config.parallax);
syncCustomModeDropdown();
syncCustomShapeDropdown();
toggleShapeSelectorVisibility();

initDB(() => {
    loadMediaFromDB();
    animate();
    DOM.settingsPanel.classList.add('hidden');
    if (DOM.mobileSettingsBtn) DOM.mobileSettingsBtn.classList.remove('panel-open');
});
