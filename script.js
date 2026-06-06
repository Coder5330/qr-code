const BORDER = 2;
const CELL = 10;
const LOGO_RATIO = 0.26;

// ── Seeded RNG (mulberry32) ────────────────────────────────────────────────
function hashStr(str) {
    let h = 0x9e3779b9;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9);
        h ^= h >>> 16;
    }
    return h >>> 0;
}

function seededRng(seed) {
    let s = seed;
    return () => {
        s += 0x6D2B79F5;
        let t = s;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const FRAME_CFG = {
    'none':           { fp: 0,  ft: 0,  fb: 0  },
    'bottom':         { fp: 8,  ft: 0,  fb: 36 },
    'border-bottom':  { fp: 8,  ft: 0,  fb: 36 },
    'rounded-bottom': { fp: 8,  ft: 0,  fb: 36 },
    'top-banner':     { fp: 8,  ft: 36, fb: 0  },
    'circle':         { fp: 0,  ft: 0,  fb: 32 },
    'phone':          { fp: 18, ft: 44, fb: 44 },
    'clipboard':      { fp: 14, ft: 30, fb: 36 },
};

const canvas = document.getElementById("qr");
const ctx = canvas.getContext("2d");
const input = document.getElementById("data");
const downloadBtn = document.getElementById("download");
const copyBtn = document.getElementById("copy");
const errorMsg = document.getElementById("error");

let selectedFrame = 'none';
let selectedShape = 'default';
let selectedLogo = 'none';
let selectedMenu = 'frame';
let customLogoImage = null;

// ── Utilities ──────────────────────────────────────────────────────────────

function normalizeUrl(raw) {
    let s = raw.trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    if (!URL.canParse(s)) return null;
    const url = new URL(s);
    if (!url.hostname.includes(".")) return null;
    return url.href;
}

function fillRR(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
}

function strokeRR(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.stroke();
}

// ── Module drawing ─────────────────────────────────────────────────────────

// cellSize defaults to global CELL; pass a value for circle-frame scaled drawing
function drawModule(x, y, cellSize = CELL) {
    if (selectedShape === 'default') {
        ctx.fillRect(x, y, cellSize, cellSize);
        return;
    }
    const pad = cellSize * 0.1;
    const s = cellSize - pad * 2;
    const px = x + pad, py = y + pad;

    if (selectedShape === 'square') {
        ctx.fillRect(px, py, s, s);
    } else if (selectedShape === 'rounded') {
        fillRR(px, py, s, s, s * 0.32);
    } else if (selectedShape === 'dot') {
        ctx.beginPath();
        ctx.arc(px + s / 2, py + s / 2, s / 2, 0, Math.PI * 2);
        ctx.fill();
    } else if (selectedShape === 'diamond') {
        ctx.save();
        ctx.translate(px + s / 2, py + s / 2);
        ctx.rotate(Math.PI / 4);
        const ds = s * 0.72;
        ctx.fillRect(-ds / 2, -ds / 2, ds, ds);
        ctx.restore();
    }
}

// ── Frame drawing ──────────────────────────────────────────────────────────

function drawFrameBack(W, H, qrSide, fp, ft, fb) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    switch (selectedFrame) {
        case 'bottom':
            ctx.fillStyle = '#111';
            ctx.fillRect(0, H - fb, W, fb);
            break;

        case 'border-bottom':
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 3;
            ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
            ctx.fillStyle = '#111';
            ctx.fillRect(0, H - fb, W, fb);
            break;

        case 'rounded-bottom':
            ctx.fillStyle = '#111';
            fillRR(0, 0, W, H, 14);
            ctx.fillStyle = '#fff';
            fillRR(fp - 4, fp - 4, W - (fp - 4) * 2, qrSide + fp * 2 - 8, 4);
            break;

        case 'top-banner':
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, W, ft);
            break;

        case 'phone': {
            // Body
            ctx.fillStyle = '#111';
            fillRR(0, 0, W, H, 20);
            // Screen
            ctx.fillStyle = '#fff';
            fillRR(10, ft - 8, W - 20, qrSide + fp * 2 + 16, 4);
            // Camera
            ctx.fillStyle = '#555';
            ctx.beginPath();
            ctx.arc(W / 2, ft / 2.8, 3, 0, Math.PI * 2);
            ctx.fill();
            // Home indicator
            ctx.fillStyle = '#555';
            ctx.beginPath();
            ctx.arc(W / 2, H - fb / 2, 6, 0, Math.PI * 2);
            ctx.fill();
            break;
        }

        case 'clipboard': {
            // Board body
            ctx.fillStyle = '#fff';
            fillRR(0, ft / 2, W, H - ft / 2, 8);
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 2.5;
            strokeRR(1.25, ft / 2 + 1.25, W - 2.5, H - ft / 2 - 2.5, 8);
            // Bottom bar
            ctx.fillStyle = '#111';
            fillRR(1, H - fb, W - 2, fb - 1, 6);
            // Clip piece
            const clipW = Math.min(W * 0.36, 56);
            const clipH = ft * 0.88;
            ctx.fillStyle = '#111';
            fillRR((W - clipW) / 2, 0, clipW, clipH, 5);
            const holeW = clipW * 0.5;
            const holeH = clipH * 0.48;
            ctx.fillStyle = '#fff';
            fillRR((W - holeW) / 2, clipH * 0.2, holeW, holeH, 3);
            break;
        }
    }
}

function drawFrameText(W, H, ft, fb) {
    const scanLabel = 'SCAN ME';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(Math.max(fb, ft) * 0.48)}px system-ui, sans-serif`;

    if (selectedFrame === 'top-banner') {
        ctx.fillStyle = '#fff';
        ctx.fillText(scanLabel, W / 2, ft / 2);
    } else if (selectedFrame === 'bottom' || selectedFrame === 'border-bottom') {
        ctx.fillStyle = '#fff';
        ctx.fillText(scanLabel, W / 2, H - fb / 2);
    } else if (selectedFrame === 'rounded-bottom') {
        ctx.fillStyle = '#fff';
        ctx.fillText(scanLabel, W / 2, H - fb / 2 + 2);
    } else if (selectedFrame === 'circle') {
        ctx.fillStyle = '#111';
        ctx.font = `bold 12px system-ui, sans-serif`;
        ctx.fillText(scanLabel, W / 2, H - fb / 2);
    } else if (selectedFrame === 'phone') {
        ctx.fillStyle = '#fff';
        ctx.font = `bold 10px system-ui, sans-serif`;
        ctx.fillText(scanLabel, W / 2, H - fb / 2 - 6);
    } else if (selectedFrame === 'clipboard') {
        ctx.fillStyle = '#fff';
        ctx.font = `bold 11px system-ui, sans-serif`;
        ctx.fillText(scanLabel, W / 2, H - fb / 2);
    }
}

// ── Logo drawing ───────────────────────────────────────────────────────────

function drawLogo(ox, oy, count) {
    const ls = count * CELL * LOGO_RATIO;
    const cx = ox + (count * CELL) / 2;
    const cy = oy + (count * CELL) / 2;
    const lx = cx - ls / 2, ly = cy - ls / 2;
    const pad = 5;

    ctx.fillStyle = '#fff';
    fillRR(lx - pad, ly - pad, ls + pad * 2, ls + pad * 2, 8);

    if (selectedLogo === 'upload' && customLogoImage) {
        ctx.save();
        ctx.beginPath();
        fillRR(lx, ly, ls, ls, 6);
        ctx.clip();
        ctx.drawImage(customLogoImage, lx, ly, ls, ls);
        ctx.restore();
    } else {
        const emojiMap = { heart: '❤️', star: '⭐', smile: '😊', camera: '📷' };
        const emoji = emojiMap[selectedLogo] || '';
        const fontSize = ls * 0.76;
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const m = ctx.measureText(emoji);
        // Center emoji's visual bounding box at (cx, cy)
        const drawX = cx - (m.actualBoundingBoxRight - (m.actualBoundingBoxLeft || 0)) / 2 + (m.actualBoundingBoxLeft || 0);
        const drawY = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        ctx.fillText(emoji, drawX, drawY);
    }
}

// ── Default placeholder matrix (shown at 0.5 opacity when input is empty) ─

const DEFAULT_MATRIX = [
    "11111110100000001001101111111",
    "10000010101000100110001000001",
    "10111010011101110001001011101",
    "10111010100101100100001011101",
    "10111010001010010001001011101",
    "10000010011001001111001000001",
    "11111110101010101010101111111",
    "00000000111100101111100000000",
    "10110111001100111111101001011",
    "01001101101100101001111110001",
    "10000010000100101000011010110",
    "01100000000111000001110000001",
    "10000110011101010110000001100",
    "01101100111001111001001000111",
    "00001110011000100011011100111",
    "11101000010100100001110100010",
    "10001011010110100011110111010",
    "01011100111110010100100001110",
    "10110111100001110110100000100",
    "00011000000001110100010100100",
    "01100011001011100111111111100",
    "00000000101000001110100011111",
    "11111110111110101111101011010",
    "10000010101011100000100011001",
    "10111010001110010110111110111",
    "10111010101111011001000011001",
    "10111010111011101110000100101",
    "10000010000000001010101111010",
    "11111110100101101011110101010",
];

function renderMatrix(isDark, count, alpha = 1) {
    const qrSide = (count + BORDER * 2) * CELL;
    const { fp, ft, fb } = FRAME_CFG[selectedFrame] || FRAME_CFG['none'];
    const W = qrSide + fp * 2;
    const H = qrSide + fp * 2 + ft + fb;

    // canvas resize resets ALL context state (incl. globalAlpha), so set alpha after
    canvas.width = W;
    canvas.height = H;
    ctx.globalAlpha = alpha;

    if (selectedFrame === 'circle') {
        drawCircleFrame({ isDark: (r, c) => isDark(r, c) }, count, alpha);
        ctx.globalAlpha = 1;
        return;
    }

    drawFrameBack(W, H, qrSide, fp, ft, fb);
    const ox = fp + BORDER * CELL;
    const oy = fp + BORDER * CELL + ft;
    ctx.fillStyle = '#111';
    for (let r = 0; r < count; r++)
        for (let c = 0; c < count; c++)
            if (isDark(r, c)) drawModule(ox + c * CELL, oy + r * CELL);
    drawFrameText(W, H, ft, fb);
    if (selectedLogo !== 'none') drawLogo(ox, oy, count);
    ctx.globalAlpha = 1;
}

// ── Main QR draw ───────────────────────────────────────────────────────────

function drawQR(data) {
    const showDefault = () => renderMatrix((r, c) => DEFAULT_MATRIX[r][c] === '1', DEFAULT_MATRIX.length, 0.5);

    if (!data.trim()) {
        errorMsg.textContent = "";
        downloadBtn.disabled = true;
        copyBtn.disabled = true;
        showDefault();
        return;
    }

    const url = normalizeUrl(data);
    if (!url) {
        errorMsg.textContent = "That doesn't look like a valid URL.";
        downloadBtn.disabled = true;
        copyBtn.disabled = true;
        showDefault();
        return;
    }

    errorMsg.textContent = "";
    downloadBtn.disabled = false;
    copyBtn.disabled = false;

    const ecLevel = selectedLogo !== 'none' ? 'H' : 'M';
    const qr = qrcode(0, ecLevel);
    qr.addData(url);
    qr.make();

    renderMatrix((r, c) => qr.isDark(r, c), qr.getModuleCount());
}

// ── Circle frame ──────────────────────────────────────────────────────────
// Fixed circle size. QR inscribed so corners touch circle.
// Corner arc areas filled with a URL-independent deterministic pattern.

const CIRCLE_R   = 144;
const CIRCLE_PAD = 4;
const CIRCLE_FB  = 34;

function isCornerDot(col, row) {
    // Mix col + row into a single seed, then apply MurmurHash3 finalizer for good diffusion
    let h = (Math.imul(col + 1000, 0x45d9f3b) ^ Math.imul(row + 1000, 0x119de1f3)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) % 100 < 38; // ~38% fill density
}

function drawCircleFrame(qr, count, alpha = 1) {
    const R   = CIRCLE_R;
    const pad = CIRCLE_PAD;
    const fb  = CIRCLE_FB;

    const W = 2 * (R + pad);
    const H = W + fb;
    canvas.width  = W;
    canvas.height = H;
    ctx.globalAlpha = alpha; // must be set after canvas resize resets context

    const Cx = R + pad;
    const Cy = R + pad;

    // Scale QR so corners land on circle: side = R*sqrt(2)
    const totalCells = count + BORDER * 2;
    const cell = (R * Math.SQRT2) / totalCells;

    const qrLeft = Cx - (R * Math.SQRT2) / 2;
    const qrTop  = Cy - (R * Math.SQRT2) / 2;

    // White background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(Cx, Cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fill();

    // How many extra cells fit in the arc bulge beyond QR sides?
    const extraCells = Math.ceil((R * (1 - 1 / Math.SQRT2)) / cell) + 1;

    // Corner decoration: cells inside circle but outside the actual QR data area.
    // We allow drawing into the quiet-zone border (which is all-white in the real QR)
    // so there's no visible gap between the random squares and the finder patterns.
    ctx.fillStyle = '#111';
    for (let row = -extraCells; row < totalCells + extraCells; row++) {
        for (let col = -extraCells; col < totalCells + extraCells; col++) {
            // Skip only the true data area (quiet zone is fair game for decoration)
            if (col >= BORDER && col < BORDER + count && row >= BORDER && row < BORDER + count) continue;

            const mx  = qrLeft + col * cell;
            const my  = qrTop  + row * cell;
            const mcx = mx + cell / 2;
            const mcy = my + cell / 2;

            if (Math.hypot(mcx - Cx, mcy - Cy) > R - cell * 0.25) continue;
            if (!isCornerDot(col, row)) continue;

            drawModule(mx, my, cell);
        }
    }

    // Actual QR modules
    const ox = qrLeft + BORDER * cell;
    const oy = qrTop  + BORDER * cell;
    ctx.fillStyle = '#111';
    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) drawModule(ox + c * cell, oy + r * cell, cell); // works for both qrcode obj and {isDark} wrapper
        }
    }

    ctx.restore();

    // Circle border
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(Cx, Cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // "SCAN ME" label
    ctx.fillStyle = '#111';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCAN ME', W / 2, H - fb / 2);

    // Logo (scaled to match circle's cell size)
    if (selectedLogo !== 'none') {
        const ls   = count * cell * LOGO_RATIO;
        const lcx  = ox + (count * cell) / 2;
        const lcy  = oy + (count * cell) / 2;
        const lpad = cell * 0.5;
        ctx.fillStyle = '#fff';
        fillRR(lcx - ls / 2 - lpad, lcy - ls / 2 - lpad, ls + lpad * 2, ls + lpad * 2, 6);
        if (selectedLogo === 'upload' && customLogoImage) {
            ctx.save();
            ctx.beginPath();
            fillRR(lcx - ls / 2, lcy - ls / 2, ls, ls, 4);
            ctx.clip();
            ctx.drawImage(customLogoImage, lcx - ls / 2, lcy - ls / 2, ls, ls);
            ctx.restore();
        } else {
            const emojiMap = { heart: '❤️', star: '⭐', smile: '😊', camera: '📷' };
            const emoji = emojiMap[selectedLogo] || '';
            ctx.font = `${ls * 0.76}px serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            const m = ctx.measureText(emoji);
            ctx.fillText(emoji,
                lcx - (m.actualBoundingBoxRight - (m.actualBoundingBoxLeft || 0)) / 2 + (m.actualBoundingBoxLeft || 0),
                lcy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
        }
    }
}

// ── Selection helpers ──────────────────────────────────────────────────────

function setSelected(panelSel, attr, value) {
    document.querySelectorAll(`${panelSel} .choice-btn`).forEach(b => b.classList.remove('selected'));
    const t = document.querySelector(`${panelSel} .choice-btn[${attr}="${value}"]`);
    if (t) t.classList.add('selected');
}

function selectFrame(frame) {
    selectedFrame = frame;
    setSelected('.style-frame-choices', 'data-frame', frame);
    drawQR(input.value);
}

function selectShape(shape) {
    selectedShape = shape;
    setSelected('.style-shape-choices', 'data-shape', shape);
    drawQR(input.value);
}

function selectLogo(logo) {
    selectedLogo = logo;
    setSelected('.style-logo-choices', 'data-logo', logo);
    drawQR(input.value);
}

function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
        customLogoImage = img;
        selectedLogo = 'upload';
        document.querySelectorAll('.style-logo-choices .choice-btn').forEach(b => b.classList.remove('selected'));
        document.querySelector('.upload-btn').classList.add('selected');
        drawQR(input.value);
    };
    img.src = URL.createObjectURL(file);
}

function toggleMenu(menu) {
    document.querySelectorAll('.style-choices').forEach(el => el.classList.remove('active'));
    document.querySelector(`.style-${menu}-choices`).classList.add('active');
    document.querySelectorAll('.menu-button').forEach(el => el.classList.remove('active'));
    document.querySelector(`[onclick="toggleMenu('${menu}')"]`).classList.add('active');
    selectedMenu = menu;
}

// ── Download / Copy ────────────────────────────────────────────────────────

function downloadQR() {
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "qrcode.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

async function copyQR() {
    try {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
        alert("Couldn't copy — your browser may not support image clipboard, or the page isn't on HTTPS.");
    }
}

// ── Init ───────────────────────────────────────────────────────────────────

canvas.height = canvas.width = 330;
// Set initial selections (don't rely on HTML class state)
setSelected('.style-frame-choices', 'data-frame', selectedFrame);
setSelected('.style-shape-choices', 'data-shape', selectedShape);
setSelected('.style-logo-choices', 'data-logo', selectedLogo);
drawQR(input.value);
toggleMenu(selectedMenu);
input.addEventListener("input", () => drawQR(input.value));
