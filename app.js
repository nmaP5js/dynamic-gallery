// State Variables
let mediaItems = [];
let animationFrameId = null;
let scrollOffset = 0;

const lerp = (a, b, t) => a + (b - a) * t;

// IndexedDB persistence settings
const DB_NAME = 'DynamicCollageDB';
const DB_VERSION = 1;
const STORE_NAME = 'media';
let db = null;

// Config state linked to UI controls
const config = {
    mode: 'drift', // 'orbit' or 'drift'
    speed: 0.5,
    scale: 1.0,
    spread: 1.0,
    shape: 'heart',
    customShapePoints: null
};

// DOM Elements
const artboard = document.getElementById('artboard');
const settingsPanel = document.getElementById('settings-panel');
const controlMode = document.getElementById('control-mode');
const controlSpeed = document.getElementById('control-speed');
const controlScale = document.getElementById('control-scale');
const controlSpread = document.getElementById('control-spread');
const controlUpload = document.getElementById('control-upload');
const controlClear = document.getElementById('control-clear');
const controlReset = document.getElementById('control-reset');
const controlExport = document.getElementById('control-export');
const controlUrlInput = document.getElementById('control-url-input');
const controlUrlSubmit = document.getElementById('control-url-submit');

// New Shape selector and drawing elements
const controlShape = document.getElementById('control-shape');
const shapeSelectorSection = document.getElementById('shape-selector-section');
const customShapeSelect = document.getElementById('custom-shape-select');
const controlShapeUpload = document.getElementById('control-shape-upload');

const drawingOverlay = document.getElementById('drawing-overlay');
const drawingCanvas = document.getElementById('drawing-canvas');
const cancelDrawingBtn = document.getElementById('cancel-drawing-btn');


// --- Shape Flow Math & Custom Shape Operations ---
let isDrawing = false;
let drawingPoints = [];
let drawingCtx = null;

function getShapeCoordinates(shapeName, t, vw, vh) {
    const baseSize = Math.min(vw, vh) * 0.35 * config.spread;
    let x = 0, y = 0;
    
    switch (shapeName) {
        case 'heart':
            // Parametric Heart curve
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            x = (hx / 16) * baseSize;
            // Align visually and slightly compress Y for aesthetics
            y = (hy / 16) * baseSize * 0.95;
            break;
            
        case 'star':
            // 5-pointed star polar curve (smooth lobes)
            const r = baseSize * (0.62 + 0.38 * Math.cos(5 * t));
            x = r * Math.sin(t); // rotate 90 deg so tip points straight up
            y = -r * Math.cos(t);
            break;
            
        case 'infinity':
            // Lemniscate of Bernoulli (figure-8)
            const denom = 1 + Math.pow(Math.sin(t), 2);
            x = (baseSize * 1.25 * Math.cos(t)) / denom;
            y = (baseSize * 1.25 * Math.sin(t) * Math.cos(t)) / denom;
            break;
            
        case 'custom':
            if (config.customShapePoints && config.customShapePoints.length > 0) {
                // Map continuous t (0 to 2pi) to normalized coordinates array
                const percent = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
                const idx = Math.floor(percent * config.customShapePoints.length);
                const pt = config.customShapePoints[idx % config.customShapePoints.length];
                
                // Scale normalized coordinate (ranges -0.5 to 0.5) to viewport bounds
                const customBase = Math.min(vw, vh) * 0.75 * config.spread;
                x = pt.x * customBase;
                y = pt.y * customBase;
            }
            break;
            
        default:
            x = baseSize * Math.cos(t);
            y = baseSize * Math.sin(t);
            break;
    }
    
    return { x, y };
}

function updateShapeOverlayPath() {
    const overlay = document.getElementById('shape-overlay');
    const pathEl = document.getElementById('shape-path');
    if (!overlay || !pathEl) return;
    
    if (config.mode !== 'shape') {
        overlay.style.display = 'none';
        return;
    }
    
    overlay.style.display = 'block';
    
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = vw / 2;
    const cy = vh / 2;
    
    const points = [];
    const numPoints = 150; // High resolution path representation
    
    for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        const pt = getShapeCoordinates(config.shape, t, vw, vh);
        points.push(`${cx + pt.x},${cy + pt.y}`);
    }
    
    pathEl.setAttribute('d', 'M ' + points.join(' L ') + ' Z');
}

function loadCustomSvgPath(dAttribute) {
    const overlay = document.getElementById('shape-overlay');
    if (!overlay) return;
    
    // Create temporary path element inside overlay to measure geometry
    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("d", dAttribute);
    overlay.appendChild(tempPath);
    
    const bbox = tempPath.getBBox();
    const totalLength = tempPath.getTotalLength();
    
    if (totalLength === 0 || bbox.width === 0 || bbox.height === 0) {
        overlay.removeChild(tempPath);
        return; // invalid path geometry
    }
    
    // Sample 200 coordinates along the custom vector path
    const numSamples = 200;
    const sampledPoints = [];
    
    for (let i = 0; i < numSamples; i++) {
        const dist = (i / numSamples) * totalLength;
        const pt = tempPath.getPointAtLength(dist);
        
        // Center coordinates and normalize to -0.5 ... 0.5 scale
        const normX = (pt.x - bbox.x - bbox.width / 2) / Math.max(bbox.width, bbox.height);
        const normY = (pt.y - bbox.y - bbox.height / 2) / Math.max(bbox.width, bbox.height);
        
        sampledPoints.push({ x: normX, y: normY });
    }
    
    overlay.removeChild(tempPath);
    
    // Save normalized coordinates
    config.customShapePoints = sampledPoints;
    config.shape = 'custom';
    controlShape.value = 'custom';
    
    // Dynamic Custom Option display injection
    ensureCustomOptionInDropdown();
    
    // Reset shape animation variables for smooth transition
    mediaItems.forEach((item, idx) => {
        item.shapeAngle = (idx * 2 * Math.PI) / Math.max(1, mediaItems.length);
    });
    
    updateShapeOverlayPath();
    syncCustomShapeDropdown();
}

function ensureCustomOptionInDropdown() {
    // Check if Custom option already exists in native select
    let customOpt = Array.from(controlShape.options).find(opt => opt.value === 'custom');
    if (!customOpt) {
        customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = 'Custom (Perso)';
        controlShape.appendChild(customOpt);
    }
    customOpt.selected = true;
    
    // Check if Custom option already exists in custom dropdown options list
    const customOptionsList = customShapeSelect.querySelector('.custom-select-options');
    let customDivOpt = customOptionsList.querySelector('.custom-option[data-value="custom"]');
    if (!customDivOpt) {
        customDivOpt = document.createElement('div');
        customDivOpt.className = 'custom-option';
        customDivOpt.setAttribute('data-value', 'custom');
        customDivOpt.textContent = 'Custom (Perso)';
        
        // Insert custom option before Draw option to keep special controls at the bottom
        const drawOpt = customOptionsList.querySelector('.custom-option[data-value="draw"]');
        customOptionsList.insertBefore(customDivOpt, drawOpt);
        
        // Add click listener to newly added custom option
        customDivOpt.addEventListener('click', (e) => {
            controlShape.value = 'custom';
            controlShape.dispatchEvent(new Event('change'));
            customShapeSelect.classList.remove('open');
        });
    }
}

function toggleShapeSelectorVisibility() {
    if (config.mode === 'shape') {
        shapeSelectorSection.style.display = 'flex';
        updateShapeOverlayPath();
    } else {
        shapeSelectorSection.style.display = 'none';
        const overlay = document.getElementById('shape-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

function createMediaElement(src) {
    const container = document.createElement('div');
    container.className = 'collage-item';
    
    const el = document.createElement('img');
    el.crossOrigin = "anonymous";
    el.src = src;
    el.onload = () => {
        const aspect = el.naturalWidth / el.naturalHeight;
        setMediaDimensions(item, aspect);
    };
    
    container.appendChild(el);
    artboard.appendChild(container);
    
    // Setup state parameters for animation
    const item = {
        element: container,
        media: el,
        // Default sizes while loading
        baseWidth: 280,
        baseHeight: 380,
        
        // Position state
        x: 0,
        y: 0,
        z: 0,
        
        // Drift Physics state (pixel velocities)
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        dz: (Math.random() - 0.5) * 1.5,
        
        // Orbit state
        orbitAngle: 0,
        orbitSpeedFactor: 0.8 + Math.random() * 0.4,
        
        // Random variance
        seed: Math.random() * 100,
        noiseOffset: Math.random() * Math.PI * 2
    };
    
    // Set default styles while loading
    container.style.width = '280px';
    container.style.height = '380px';
    container.style.marginLeft = '-140px';
    container.style.marginTop = '-190px';
    
    mediaItems.push(item);
    distributeElements();
    return item;
}

function setMediaDimensions(item, aspect) {
    if (!aspect || isNaN(aspect)) return;
    
    let width = 280;
    let height = 380;
    
    const referenceSize = 340; // Max bounding dimension
    
    if (aspect > 1) {
        // Landscape (horizontal)
        width = referenceSize;
        height = referenceSize / aspect;
    } else {
        // Portrait or square (vertical)
        height = referenceSize;
        width = referenceSize * aspect;
    }
    
    item.baseWidth = width;
    item.baseHeight = height;
    
    item.element.style.width = `${width}px`;
    item.element.style.height = `${height}px`;
    item.element.style.marginLeft = `${-width / 2}px`;
    item.element.style.marginTop = `${-height / 2}px`;
    
    // Recalculate track spacing for 2D modes based on updated dimensions
    distributeElements();
}

// Distribute angles/positions when items change or mode swaps
function distributeElements() {
    const n = mediaItems.length;
    if (n === 0) return;
    
    // Arrays to count items per track for standard modes
    const leftItems = [];
    const rightItems = [];
    const topItems = [];
    const bottomItems = [];
    
    // Arrays for the 3-column Grid Flow mode
    const gridCols = [[], [], []];
    
    // Grid geometry for Assemble mode
    let cols = 3;
    if (n <= 3) cols = n;
    else if (n <= 6) cols = 3;
    else cols = 4;
    
    const rows = Math.ceil(n / cols);
    
    // Spacing between grid cells
    const colSpacing = 310;
    const rowSpacing = 410;
    const gridWidth = (cols - 1) * colSpacing;
    const gridHeight = (rows - 1) * rowSpacing;
    
    mediaItems.forEach((item, i) => {
        // Orbit starting angles distributed evenly around circle
        item.orbitAngle = (i * 2 * Math.PI) / n;
        
        if (config.mode === 'tunnel') {
            // Space items evenly along the tunnel depth to prevent bunching (range: -2500 to 500)
            item.z = -2500 + (i / n) * 3000;
            item.x = (Math.random() - 0.5) * window.innerWidth * 0.6;
            item.y = (Math.random() - 0.5) * window.innerHeight * 0.6;
        } else if (config.mode === 'cinematic') {
            // Spaced evenly along the diagonal with randomized depth layers
            item.z = -200 + Math.random() * 300;
            item.x = -window.innerWidth * 0.7 + (i / n) * window.innerWidth * 1.4;
            item.y = window.innerHeight * 0.7 - (i / n) * window.innerHeight * 1.4;
        } else if (config.mode === 'vortex') {
            // Distribute radius and angles to make a spiral galaxy form on mode load
            const maxRadius = Math.max(window.innerWidth, window.innerHeight) * 0.6;
            item.vortexRadius = (i / n) * maxRadius;
            item.vortexAngle = (i * 2 * Math.PI) / n + Math.random() * 0.5;
            item.z = -1200 + (item.vortexRadius / maxRadius) * 1400;
        } else if (config.mode === 'pendulum') {
            // Distribute anchor points evenly along the screen width
            item.anchorX = -window.innerWidth * 0.55 + (i / Math.max(1, n - 1)) * window.innerWidth * 1.1;
            item.pendulumLength = window.innerHeight * (0.35 + 0.3 * Math.random());
            item.pendulumPhase = Math.random() * Math.PI * 2;
            item.pendulumMaxAngle = 0.15 + Math.random() * 0.15; // in radians
        } else {
            // Drift random initial positions in viewport
            const rangeX = window.innerWidth * 0.6;
            const rangeY = window.innerHeight * 0.6;
            if (item.x === 0 && item.y === 0) {
                item.x = (Math.random() - 0.5) * rangeX;
                item.y = (Math.random() - 0.5) * rangeY;
                item.z = (Math.random() - 0.5) * 300;
            }
        }
        
        // Assign to Left / Right column tracks
        if (i % 2 === 0) {
            item.columnTrack = 'left';
            item.columnIndex = leftItems.length;
            leftItems.push(item);
        } else {
            item.columnTrack = 'right';
            item.columnIndex = rightItems.length;
            rightItems.push(item);
        }
        
        // Assign to Top / Bottom row tracks
        if (i % 2 === 0) {
            item.rowTrack = 'top';
            item.rowIndex = topItems.length;
            topItems.push(item);
        } else {
            item.rowTrack = 'bottom';
            item.rowIndex = bottomItems.length;
            bottomItems.push(item);
        }
        
        // Assign to 3-column Grid Flow tracks
        const gridColIdx = i % 3;
        item.gridColTrack = gridColIdx;
        item.gridColIndex = gridCols[gridColIdx].length;
        gridCols[gridColIdx].push(item);
        
        // Target Coordinates for Assemble Mode grid layout
        const cIdx = i % cols;
        const rIdx = Math.floor(i / cols);
        item.targetGridX = cIdx * colSpacing - gridWidth / 2;
        item.targetGridY = rIdx * rowSpacing - gridHeight / 2;
    });
}

function clearAllMedia() {
    mediaItems.forEach(item => {
        if (item.element) {
            item.element.remove();
        }
    });
    mediaItems = [];
}

// --- Animation Loop ---
function animate() {
    const time = performance.now() * 0.001; // Seconds elapsed
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    // Increment continuous offset for scrolling modes
    scrollOffset += 1.5 * config.speed;
    
    // Bounds for Drift bounding box
    const marginX = vw * 0.35;
    const marginY = vh * 0.35;
    const minZ = -400;
    const maxZ = 200;

    // Count how many items in each partition for proper spacing calculations
    const numLeft = mediaItems.filter(item => item.columnTrack === 'left').length;
    const numRight = mediaItems.filter(item => item.columnTrack === 'right').length;
    const numTop = mediaItems.filter(item => item.rowTrack === 'top').length;
    const numBottom = mediaItems.filter(item => item.rowTrack === 'bottom').length;
    const numCol0 = mediaItems.filter(item => item.gridColTrack === 0).length;
    const numCol1 = mediaItems.filter(item => item.gridColTrack === 1).length;
    const numCol2 = mediaItems.filter(item => item.gridColTrack === 2).length;

    mediaItems.forEach((item) => {
        let x = 0, y = 0, z = 0;
        
        if (config.mode === 'orbit') {
            // --- Mode 1: 3D Orbit ---
            item.orbitAngle += 0.003 * config.speed * item.orbitSpeedFactor;
            
            const radiusX = (vw * 0.32) * config.spread;
            const radiusZ = 300 * config.spread;
            const radiusY = (vh * 0.1) * config.spread;
            
            x = Math.cos(item.orbitAngle) * radiusX;
            z = Math.sin(item.orbitAngle) * radiusZ;
            y = Math.sin(item.orbitAngle * 2 + item.noiseOffset) * radiusY + (Math.sin(item.seed) * vh * 0.1);
            
            item.x = x;
            item.y = y;
            item.z = z;
        } else if (config.mode === 'orbit2d') {
            // --- Mode 2: 2D Orbit ---
            item.orbitAngle += 0.003 * config.speed * item.orbitSpeedFactor;
            
            const radiusX = (vw * 0.32) * config.spread;
            const radiusY = (vh * 0.25) * config.spread;
            
            x = Math.cos(item.orbitAngle) * radiusX;
            y = Math.sin(item.orbitAngle) * radiusY;
            z = 0;
            
            item.x = x;
            item.y = y;
            item.z = z;
        } else if (config.mode === 'drift') {
            // --- Mode 3: 3D Drift ---
            item.x += item.dx * config.speed;
            item.y += item.dy * config.speed;
            item.z += item.dz * config.speed;
            
            item.x += Math.sin(time + item.seed) * 0.2;
            item.y += Math.cos(time + item.seed) * 0.2;
            
            if (item.x < -marginX) { item.x = -marginX; item.dx = Math.abs(item.dx); }
            if (item.x > marginX) { item.x = marginX; item.dx = -Math.abs(item.dx); }
            
            if (item.y < -marginY) { item.y = -marginY; item.dy = Math.abs(item.dy); }
            if (item.y > marginY) { item.y = marginY; item.dy = -Math.abs(item.dy); }
            
            if (item.z < minZ) { item.z = minZ; item.dz = Math.abs(item.dz); }
            if (item.z > maxZ) { item.z = maxZ; item.dz = -Math.abs(item.dz); }
            
            x = item.x;
            y = item.y;
            z = item.z;
        } else if (config.mode === 'columns') {
            // --- Mode 4: 2D Columns (Left Down, Right Up) ---
            const trackNum = item.columnTrack === 'left' ? numLeft : numRight;
            
            // vertical spacing (image height 380 + spacing)
            const spacingY = Math.max(440, (vh + 380) / Math.max(1, trackNum));
            const loopHeight = trackNum * spacingY;
            
            if (item.columnTrack === 'left') {
                const yRaw = item.columnIndex * spacingY + scrollOffset;
                y = ((yRaw % loopHeight) + loopHeight) % loopHeight - (loopHeight / 2);
                x = -vw * 0.22 * config.spread;
            } else {
                const yRaw = item.columnIndex * spacingY - scrollOffset;
                y = ((yRaw % loopHeight) + loopHeight) % loopHeight - (loopHeight / 2);
                x = vw * 0.22 * config.spread;
            }
            z = 0;
        } else if (config.mode === 'rows') {
            // --- Mode 5: 2D Rows (Top Left, Bottom Right) ---
            const trackNum = item.rowTrack === 'top' ? numTop : numBottom;
            
            // horizontal spacing (image width 280 + spacing)
            const spacingX = Math.max(340, (vw + 280) / Math.max(1, trackNum));
            const loopWidth = trackNum * spacingX;
            
            if (item.rowTrack === 'top') {
                const xRaw = item.rowIndex * spacingX - scrollOffset;
                x = ((xRaw % loopWidth) + loopWidth) % loopWidth - (loopWidth / 2);
                y = -vh * 0.22 * config.spread;
            } else {
                const xRaw = item.rowIndex * spacingX + scrollOffset;
                x = ((xRaw % loopWidth) + loopWidth) % loopWidth - (loopWidth / 2);
                y = vh * 0.22 * config.spread;
            }
            z = 0;
        } else if (config.mode === 'tunnel') {
            // --- Mode 6: 3D Tunnel Zoom ---
            // Move item forward in Z
            item.z += 1.8 * config.speed;
            
            // If item flies past camera, wrap to deep background and randomize X/Y offsets
            if (item.z > 500) {
                item.z = -2500;
                item.x = (Math.random() - 0.5) * vw * 0.6;
                item.y = (Math.random() - 0.5) * vh * 0.6;
            }
            
            x = item.x;
            y = item.y;
            z = item.z;
        } else if (config.mode === 'assemble') {
            // --- Mode 7: Assemble (Drift/Grid Cycle) ---
            // Update base drift coordinates in background
            item.x += item.dx * config.speed;
            item.y += item.dy * config.speed;
            item.z += item.dz * config.speed;
            
            if (item.x < -marginX) { item.x = -marginX; item.dx = Math.abs(item.dx); }
            if (item.x > marginX) { item.x = marginX; item.dx = -Math.abs(item.dx); }
            if (item.y < -marginY) { item.y = -marginY; item.dy = Math.abs(item.dy); }
            if (item.y > marginY) { item.y = marginY; item.dy = -Math.abs(item.dy); }
            if (item.z < minZ) { item.z = minZ; item.dz = Math.abs(item.dz); }
            if (item.z > maxZ) { item.z = maxZ; item.dz = -Math.abs(item.dz); }
            
            // Timers: 12-second cycle (8s drift, 4s grid)
            const cycleTime = time % 12;
            let t = 0; // target grid weight
            
            if (cycleTime >= 7 && cycleTime < 8) {
                t = cycleTime - 7; // assembly transit (1 second)
            } else if (cycleTime >= 8 && cycleTime < 11) {
                t = 1; // display grid (3 seconds)
            } else if (cycleTime >= 11 && cycleTime < 12) {
                t = 1 - (cycleTime - 11); // explosion transit (1 second)
            }
            
            // Interpolate position
            x = lerp(item.x, item.targetGridX * config.scale, t);
            y = lerp(item.y, item.targetGridY * config.scale, t);
            z = lerp(item.z, 0, t);
            
            // Save local weight for rotation calculation
            item.gatherWeight = t;
        } else if (config.mode === 'grid') {
            // --- Mode 8: Grid Flow 2D Scrolling ---
            const colTrackIdx = item.gridColTrack;
            const trackNum = colTrackIdx === 0 ? numCol0 : (colTrackIdx === 1 ? numCol1 : numCol2);
            
            const spacingY = Math.max(440, (vh + 380) / Math.max(1, trackNum));
            const loopHeight = trackNum * spacingY;
            
            let yRaw;
            if (colTrackIdx === 1) {
                // Middle column scrolls DOWN
                yRaw = item.gridColIndex * spacingY + scrollOffset;
            } else {
                // Left and right columns scroll UP
                yRaw = item.gridColIndex * spacingY - scrollOffset;
            }
            
            y = ((yRaw % loopHeight) + loopHeight) % loopHeight - (loopHeight / 2);
            x = (colTrackIdx - 1) * vw * 0.28 * config.spread;
            z = 0;
        } else if (config.mode === 'cinematic') {
            // --- Mode 9: Cinematic Diagonal Sweep ---
            // Calculate depth layers for multiplane parallax (Z ranges from -200 to 100)
            const nDepth = (item.z + 200) / 300;
            const speedFactor = 0.5 + nDepth * 0.7; // foreground moves faster
            
            item.x += config.speed * 0.75 * speedFactor;
            item.y -= config.speed * 0.75 * speedFactor;
            
            const limitX = vw * 0.75;
            const limitY = vh * 0.75;
            
            // Wrap back to bottom-left
            if (item.x > limitX || item.y < -limitY) {
                item.x = -limitX;
                item.y = limitY + (Math.random() - 0.5) * 150;
                item.z = -200 + Math.random() * 300;
            }
            
            x = item.x;
            y = item.y;
            z = item.z;
            
            // Soft edge fading weight (fades out within 20% of the screen borders)
            const fadeX = Math.min(1, (limitX - Math.abs(x)) / (limitX * 0.2));
            const fadeY = Math.min(1, (limitY - Math.abs(y)) / (limitY * 0.2));
            item.fadeOpacity = Math.max(0, Math.min(1, fadeX * fadeY));
        } else if (config.mode === 'vortex') {
            // --- Mode 10: Vortex 3D Spiral ---
            const maxRadius = Math.max(vw, vh) * 0.6;
            if (item.vortexRadius === undefined) {
                item.vortexRadius = Math.random() * maxRadius;
                item.vortexAngle = Math.random() * Math.PI * 2;
            }
            
            item.vortexAngle += 0.006 * config.speed;
            item.vortexRadius += 1.2 * config.speed;
            
            if (item.vortexRadius > maxRadius) {
                item.vortexRadius = 0;
                item.vortexAngle = Math.random() * Math.PI * 2;
            }
            
            x = Math.cos(item.vortexAngle) * item.vortexRadius * config.spread;
            y = Math.sin(item.vortexAngle) * item.vortexRadius * config.spread;
            z = -1200 + (item.vortexRadius / maxRadius) * 1400;
            
            // Fade in at center and fade out at outer boundary
            let opacityWeight = 1.0;
            if (item.vortexRadius < maxRadius * 0.15) {
                opacityWeight = item.vortexRadius / (maxRadius * 0.15);
            } else if (item.vortexRadius > maxRadius * 0.8) {
                opacityWeight = 1.0 - (item.vortexRadius - maxRadius * 0.8) / (maxRadius * 0.2);
            }
            item.fadeOpacity = Math.max(0, Math.min(1, opacityWeight));
            
            item.x = x;
            item.y = y;
            item.z = z;
        } else if (config.mode === 'pendulum') {
            // --- Mode 11: Pendulum Gravity Sway ---
            if (item.anchorX === undefined) {
                item.anchorX = (Math.random() - 0.5) * vw * 0.8;
                item.pendulumLength = vh * (0.35 + 0.3 * Math.random());
                item.pendulumPhase = Math.random() * Math.PI * 2;
                item.pendulumMaxAngle = 0.15 + Math.random() * 0.15;
            }
            
            const omega = 1.6 * config.speed;
            const theta = item.pendulumMaxAngle * Math.sin(omega * time + item.pendulumPhase);
            
            x = item.anchorX + Math.sin(theta) * item.pendulumLength * config.spread;
            y = -vh * 0.45 + Math.cos(theta) * item.pendulumLength;
            z = Math.sin(time + item.seed) * 50; // subtle depth swing
            
            item.pendulumAngle = theta * (180 / Math.PI) * 0.8;
            
            item.x = x;
            item.y = y;
            item.z = z;
        } else if (config.mode === 'shape') {
            // --- Mode 12: Shape Flow ---
            if (item.shapeAngle === undefined) {
                // Distribute items evenly along the path when starting
                item.shapeAngle = (mediaItems.indexOf(item) * 2 * Math.PI) / Math.max(1, mediaItems.length);
            }
            
            // Advance angle based on speed
            item.shapeAngle += 0.002 * config.speed;
            
            const pt = getShapeCoordinates(config.shape, item.shapeAngle, vw, vh);
            x = pt.x;
            y = pt.y;
            // Add a subtle 3D wave depth swing to keep lookbook dimensional
            z = Math.sin(item.shapeAngle * 3 + item.seed) * 80 * config.spread;
            
            item.x = x;
            item.y = y;
            item.z = z;
        }
        
        // --- 3D Depth Rendering ---
        let modeMinZ = minZ;
        let modeMaxZ = maxZ;
        if (config.mode === 'tunnel') {
            modeMinZ = -2500;
            modeMaxZ = 500;
        } else if (config.mode === 'vortex') {
            modeMinZ = -1200;
            modeMaxZ = 200;
        }
        
        const normalizedDepth = (z - modeMinZ) / (modeMaxZ - modeMinZ);
        
        // Size modifier + config scale
        const scaleFactor = (0.55 + normalizedDepth * 0.7) * config.scale;
        
        
        // Arrange proper CSS layers using rounded Z values (between 1 and 1000)
        const zIndex = Math.round(normalizedDepth * 900) + 50;
        
        // Total transforms
        const finalX = x;
        const finalY = y;
        
        // Rotate slightly based on movement direction for organic feel
        let angleRot = 0;
        if (config.mode === 'orbit') {
            angleRot = Math.cos(item.orbitAngle) * -8;
        } else if (config.mode === 'drift') {
            angleRot = item.dx * 2;
        } else if (config.mode === 'assemble') {
            // Straighten rotation as target grid is approached
            const gatherWeight = item.gatherWeight || 0;
            angleRot = (item.dx * 2) * (1 - gatherWeight);
        } else if (config.mode === 'vortex') {
            angleRot = item.vortexAngle * (180 / Math.PI) * 0.15;
        } else if (config.mode === 'pendulum' && item.pendulumAngle !== undefined) {
            angleRot = item.pendulumAngle;
        } else if (config.mode === 'shape' && item.shapeAngle !== undefined) {
            angleRot = Math.cos(item.shapeAngle) * -8;
        }
            
        item.element.style.zIndex = zIndex;
        
        // Solid opacity by default, apply soft fade weight in cinematic and vortex modes
        const finalOpacity = (config.mode === 'cinematic' || config.mode === 'vortex') ? (item.fadeOpacity !== undefined ? item.fadeOpacity : 1.0) : 1.0;
        item.element.style.opacity = finalOpacity;
        
        // Save current coordinates for canvas export
        item.renderX = finalX;
        item.renderY = finalY;
        item.renderScale = scaleFactor;
        item.renderAngle = angleRot;
        item.renderZ = z;

        // Apply 3D translates and rotations
        item.element.style.transform = `translate3d(${finalX}px, ${finalY}px, ${z}px) rotateY(${angleRot}deg) scale(${scaleFactor})`;
    });
    
    animationFrameId = requestAnimationFrame(animate);
}


// --- IndexedDB Database Operations ---
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
        if (callback) callback(); // Proceed to boot animate anyway
    };
}

function saveMediaToDB(file) {
    if (!db) return;
    try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.add({
            blob: file,
            isVideo: false,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to save media to database:', err);
    }
}

function loadMediaFromDB() {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = (e) => {
        const items = e.target.result;
        if (items && items.length > 0) {
            hideIntroHint();
            items.forEach((item) => {
                if (item.isVideo) return; // Skip legacy video items
                
                let url;
                if (item.blob instanceof Blob) {
                    url = URL.createObjectURL(item.blob);
                } else if (typeof item.blob === 'string') {
                    url = item.blob;
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

function clearMediaDB() {
    if (!db) return;
    try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
    } catch (err) {
        console.error('Failed to clear media database:', err);
    }
}

function exportCollageAsImage() {
    if (mediaItems.length === 0) return;
    
    const canvas = document.createElement('canvas');
    // Set to 2x window dimensions for high definition capture
    const scale = 2;
    canvas.width = window.innerWidth * scale;
    canvas.height = window.innerHeight * scale;
    
    const ctx = canvas.getContext('2d');
    
    // Draw background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Sort items by their Z coordinate (depth) so we draw from back to front
    const sortedItems = [...mediaItems].sort((a, b) => a.z - b.z);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    sortedItems.forEach((item) => {
        const rx = item.renderX !== undefined ? item.renderX : item.x;
        const ry = item.renderY !== undefined ? item.renderY : item.y;
        const rScale = item.renderScale !== undefined ? item.renderScale : 1;
        const rAngle = item.renderAngle !== undefined ? item.renderAngle : 0;
        const rOpacity = item.fadeOpacity !== undefined ? item.fadeOpacity : 1.0;
        
        ctx.save();
        // Set opacity (useful for cinematic edge fades)
        ctx.globalAlpha = rOpacity;
        
        // Translate to screen space (scaled by 2x for HD)
        ctx.translate(cx + rx * scale, cy + ry * scale);
        ctx.rotate(rAngle * Math.PI / 180);
        ctx.scale(rScale * scale, rScale * scale);
        
        // Draw image
        const w = item.baseWidth;
        const h = item.baseHeight;
        
        try {
            ctx.drawImage(item.media, -w / 2, -h / 2, w, h);
        } catch (e) {
            console.error('Failed to draw element onto canvas:', e);
        }
        
        ctx.restore();
    });
    
    // Trigger download
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

// --- Settings GUI handlers ---
function toggleSettings() {
    settingsPanel.classList.toggle('hidden');
    hideIntroHint();
}

function hideIntroHint() {
    const hint = document.getElementById('intro-hint');
    if (hint && !hint.classList.contains('fade-out')) {
        hint.classList.add('fade-out');
        setTimeout(() => {
            hint.remove();
        }, 400);
    }
}

// Toggle on ESC key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') {
        toggleSettings();
    }
});

// Toggle on Double Click on background
artboard.addEventListener('dblclick', (e) => {
    // Avoid double clicking elements inside the setting panel itself
    if (!settingsPanel.contains(e.target)) {
        toggleSettings();
    }
});

// Toggle on Single Tap / Click on background (handy for mobile and simple UX)
artboard.addEventListener('click', (e) => {
    if (e.target === artboard) {
        toggleSettings();
    }
});

// Settings UI change bindings
function syncCustomModeDropdown() {
    const val = controlMode.value;
    const trigger = customSelect.querySelector('.custom-select-trigger');
    const selectedOption = customSelect.querySelector(`.custom-option[data-value="${val}"]`);
    
    if (selectedOption) {
        if (trigger) trigger.textContent = selectedOption.textContent;
        
        customSelect.querySelectorAll('.custom-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        selectedOption.classList.add('selected');
    }
}

function syncCustomShapeDropdown() {
    const val = controlShape.value;
    const trigger = customShapeSelect.querySelector('.custom-select-trigger');
    const selectedOption = customShapeSelect.querySelector(`.custom-option[data-value="${val}"]`);
    
    if (selectedOption) {
        if (trigger) trigger.textContent = selectedOption.textContent;
        
        customShapeSelect.querySelectorAll('.custom-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        selectedOption.classList.add('selected');
    }
}

controlMode.addEventListener('change', (e) => {
    config.mode = e.target.value;
    distributeElements();
    syncCustomModeDropdown();
    toggleShapeSelectorVisibility();
});

// Custom dropdown select listeners
const customSelect = document.getElementById('custom-mode-select');
const customTrigger = customSelect.querySelector('.custom-select-trigger');
const customOptions = customSelect.querySelectorAll('.custom-option');

customTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    customSelect.classList.toggle('open');
    customShapeSelect.classList.remove('open');
});

customOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
        const val = opt.getAttribute('data-value');
        controlMode.value = val;
        controlMode.dispatchEvent(new Event('change'));
        customSelect.classList.remove('open');
    });
});

// Custom shape select dropdown listeners
const customShapeTrigger = customShapeSelect.querySelector('.custom-select-trigger');

customShapeTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    customSelect.classList.remove('open');
    customShapeSelect.classList.toggle('open');
});

function bindCustomShapeOptions() {
    const customShapeOptions = customShapeSelect.querySelectorAll('.custom-option');
    customShapeOptions.forEach(opt => {
        // Use onclick to avoid stacking duplicate event listeners
        opt.onclick = (e) => {
            const val = opt.getAttribute('data-value');
            controlShape.value = val;
            controlShape.dispatchEvent(new Event('change'));
            customShapeSelect.classList.remove('open');
        };
    });
}
bindCustomShapeOptions();

controlShape.addEventListener('change', (e) => {
    const val = e.target.value;
    
    if (val === 'draw') {
        startInteractiveDrawing();
        // Reset control value to previous shape to prevent "draw" from sticking
        controlShape.value = config.shape;
        syncCustomShapeDropdown();
    } else if (val === 'upload') {
        controlShapeUpload.click();
        // Reset control value
        controlShape.value = config.shape;
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

// Close custom dropdowns when clicking outside
window.addEventListener('click', () => {
    if (customSelect.classList.contains('open')) {
        customSelect.classList.remove('open');
    }
    if (customShapeSelect.classList.contains('open')) {
        customShapeSelect.classList.remove('open');
    }
});

controlSpeed.addEventListener('input', (e) => {
    config.speed = parseFloat(e.target.value);
});

controlScale.addEventListener('input', (e) => {
    config.scale = parseFloat(e.target.value);
});

controlSpread.addEventListener('input', (e) => {
    config.spread = parseFloat(e.target.value);
    updateShapeOverlayPath();
});

controlClear.addEventListener('click', () => {
    clearAllMedia();
    clearMediaDB();
});

controlReset.addEventListener('click', () => {
    clearAllMedia();
    clearMediaDB();
    config.mode = 'drift';
    config.speed = 0.5;
    config.scale = 1.0;
    config.spread = 1.0;
    config.shape = 'heart';
    
    // Reset values in UI
    controlMode.value = 'drift';
    controlSpeed.value = 0.5;
    controlScale.value = 1.0;
    controlSpread.value = 1.0;
    controlShape.value = 'heart';
    
    // Remove injected custom option if exists
    const customOpt = Array.from(controlShape.options).find(opt => opt.value === 'custom');
    if (customOpt) customOpt.remove();
    const customDivOpt = customShapeSelect.querySelector('.custom-option[data-value="custom"]');
    if (customDivOpt) customDivOpt.remove();
    bindCustomShapeOptions();
    
    syncCustomModeDropdown();
    syncCustomShapeDropdown();
    toggleShapeSelectorVisibility();
});

controlExport.addEventListener('click', () => {
    exportCollageAsImage();
});

// Window resize listener
window.addEventListener('resize', () => {
    updateShapeOverlayPath();
});

// --- Interactive Custom Drawing canvas ---
function startInteractiveDrawing() {
    drawingOverlay.style.display = 'flex';
    
    drawingCanvas.width = window.innerWidth;
    drawingCanvas.height = window.innerHeight;
    
    drawingCtx = drawingCanvas.getContext('2d');
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
    drawingOverlay.style.display = 'none';
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

cancelDrawingBtn.addEventListener('click', () => {
    stopInteractiveDrawing(false);
});

function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function handleDrawStart(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getMousePos(drawingCanvas, e);
    drawingPoints.push(pos);
    
    drawingCtx.beginPath();
    drawingCtx.moveTo(pos.x, pos.y);
}

function handleDrawMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    
    const pos = getMousePos(drawingCanvas, e);
    drawingPoints.push(pos);
    
    drawingCtx.lineTo(pos.x, pos.y);
    drawingCtx.stroke();
}

function handleDrawEnd(e) {
    if (!isDrawing) return;
    e.preventDefault();
    stopInteractiveDrawing(true);
}

drawingCanvas.addEventListener('mousedown', handleDrawStart);
drawingCanvas.addEventListener('mousemove', handleDrawMove);
window.addEventListener('mouseup', (e) => {
    if (isDrawing && e.target === drawingCanvas) {
        handleDrawEnd(e);
    } else {
        isDrawing = false;
    }
});

drawingCanvas.addEventListener('touchstart', handleDrawStart);
drawingCanvas.addEventListener('touchmove', handleDrawMove);
drawingCanvas.addEventListener('touchend', handleDrawEnd);

// --- SVG File Upload Handler ---
controlShapeUpload.addEventListener('change', (e) => {
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
            const pointsStr = pathEl.getAttribute('points');
            const pairs = pointsStr.trim().split(/\s+/);
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

// --- File Import (Picker & Drag/Drop) ---
function handleFiles(files) {
    if (files.length === 0) return;
    hideIntroHint();
    
    Array.from(files).forEach((file) => {
        const isImage = file.type.startsWith('image/');
        if (!isImage) return;
        
        // Save Blob into database
        saveMediaToDB(file);
        
        // Create Local URL representation of the Blob (instant, low memory)
        const url = URL.createObjectURL(file);
        const item = createMediaElement(url);
        
        // Position the newly uploaded item
        const rangeX = window.innerWidth * 0.5;
        const rangeY = window.innerHeight * 0.5;
        item.x = (Math.random() - 0.5) * rangeX;
        item.y = (Math.random() - 0.5) * rangeY;
        item.z = (Math.random() - 0.5) * 300;
        item.orbitAngle = Math.random() * Math.PI * 2;
    });
}

function handleURL(url) {
    if (!url) return;
    url = url.trim();
    if (url === "") return;
    
    hideIntroHint();
    
    const addImage = (src, blobOrUrlToSave) => {
        saveMediaToDB(blobOrUrlToSave);
        const item = createMediaElement(src);
        
        // Position the newly uploaded item
        const rangeX = window.innerWidth * 0.5;
        const rangeY = window.innerHeight * 0.5;
        item.x = (Math.random() - 0.5) * rangeX;
        item.y = (Math.random() - 0.5) * rangeY;
        item.z = (Math.random() - 0.5) * 300;
        item.orbitAngle = Math.random() * Math.PI * 2;
    };
    
    // Try fetching the URL as a blob for local database persistence and high-res canvas exports
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
            controlUrlInput.value = ""; // clear input
        })
        .catch(err => {
            console.warn('CORS or network error fetching URL as blob. Falling back to direct URL load:', err);
            // Fallback: direct URL load. We save the string URL to IndexedDB so it still persists
            addImage(url, url);
            controlUrlInput.value = ""; // clear input
        });
}

// URL Input bindings
controlUrlSubmit.addEventListener('click', () => {
    handleURL(controlUrlInput.value);
});

controlUrlInput.addEventListener('keydown', (e) => {
    // Prevent default form behavior if inside form, and trigger handleURL
    if (e.key === 'Enter') {
        e.preventDefault();
        handleURL(controlUrlInput.value);
    }
});

// File Input Picker
controlUpload.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

// Drag & Drop
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('drag-over');
});

window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    // Only remove class if drag leaves window completely
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

// --- Boot Application ---
initDB(() => {
    loadMediaFromDB();
    animate();
    // Initially hide settings panel after boot so the canvas looks pure right away
    settingsPanel.classList.add('hidden');
    syncCustomModeDropdown();
    syncCustomShapeDropdown();
    toggleShapeSelectorVisibility();
});
