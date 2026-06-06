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

function isFinderPattern(r, c, count) {
    return (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
}

// cellSize defaults to global CELL; pass a value for circle-frame scaled drawing
// forceSquare: true for finder patterns so scanners can always locate the QR
function drawModule(x, y, cellSize = CELL, forceSquare = false) {
    if (forceSquare || selectedShape === 'default') {
        ctx.fillRect(x, y, cellSize, cellSize);
        return;
    }
    const pad = cellSize * 0.1;
    const s = cellSize - pad * 2;
    const px = x + pad, py = y + pad;

    if (selectedShape === 'rounded') {
        // full-size blob; drawModules adds connectors between adjacent dark cells
        fillRR(x, y, cellSize, cellSize, cellSize * 0.42);
    } else if (selectedShape === 'horizontal') {
        // fallback single-cell bar (drawModules handles run-merging)
        const bh = cellSize * 0.55;
        fillRR(x, y + (cellSize - bh) / 2, cellSize, bh, bh / 2);
    } else if (selectedShape === 'dot') {
        ctx.beginPath();
        ctx.arc(px + s / 2, py + s / 2, s / 2, 0, Math.PI * 2);
        ctx.fill();
    } else if (selectedShape === 'wavy') {
        // Warp all 4 corners via 2D sine — shared global coords means adjacent cells match at edges.
        // Edges drawn as bezier S-curves through the warped midpoint of each edge.
        const A = cellSize * 0.24, lam = cellSize * 2.6;
        const W = (gx, gy) => [
            gx + A * Math.sin(2 * Math.PI * gy / lam + 0.9),
            gy + A * Math.sin(2 * Math.PI * gx / lam)
        ];
        const curve = (p0, mgx, mgy, p2) => {
            const [mx, my] = W(mgx, mgy);
            ctx.bezierCurveTo(
                (p0[0] * 2 + mx) / 3, (p0[1] * 2 + my) / 3,
                (p2[0] * 2 + mx) / 3, (p2[1] * 2 + my) / 3,
                p2[0], p2[1]
            );
        };
        const cs = cellSize;
        const tl = W(x, y), tr = W(x + cs, y);
        const br = W(x + cs, y + cs), bl = W(x, y + cs);
        ctx.beginPath();
        ctx.moveTo(tl[0], tl[1]);
        curve(tl, x + cs / 2, y,        tr);
        curve(tr, x + cs,     y + cs / 2, br);
        curve(br, x + cs / 2, y + cs,   bl);
        curve(bl, x,          y + cs / 2, tl);
        ctx.closePath();
        ctx.fill();
    } else {
        // chamfered, jagged, arcs are neighbor-aware and handled entirely in drawModules
        ctx.fillRect(x, y, cellSize, cellSize);
    }
}

// Neighbor-aware module rendering — handles blob merging (rounded) and run-merging (horizontal)
function drawModules(isDark, count, ox, oy, cs, checkFP = true) {
    ctx.fillStyle = '#111';
    if (selectedShape === 'rounded') {
        const rad = cs * 0.42;
        for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
                if (!isDark(r, c)) continue;
                const x = ox + c * cs, y = oy + r * cs;
                if (checkFP && isFinderPattern(r, c, count)) { ctx.fillRect(x, y, cs, cs); continue; }
                fillRR(x, y, cs, cs, rad);
                // bridge to right neighbor to merge blobs
                if (c + 1 < count && isDark(r, c + 1) && !(checkFP && isFinderPattern(r, c + 1, count)))
                    ctx.fillRect(x + cs - rad, y, 2 * rad, cs);
                // bridge to bottom neighbor
                if (r + 1 < count && isDark(r + 1, c) && !(checkFP && isFinderPattern(r + 1, c, count)))
                    ctx.fillRect(x, y + cs - rad, cs, 2 * rad);
            }
        }
    } else if (selectedShape === 'horizontal') {
        // merge consecutive dark cells in each row into a single pill
        for (let r = 0; r < count; r++) {
            let c = 0;
            while (c < count) {
                if (!isDark(r, c)) { c++; continue; }
                if (checkFP && isFinderPattern(r, c, count)) {
                    ctx.fillRect(ox + c * cs, oy + r * cs, cs, cs);
                    c++; continue;
                }
                let end = c;
                while (end + 1 < count && isDark(r, end + 1) && !(checkFP && isFinderPattern(r, end + 1, count))) end++;
                const bh = cs * 0.55;
                fillRR(ox + c * cs, oy + r * cs + (cs - bh) / 2, (end - c + 1) * cs, bh, bh / 2);
                c = end + 1;
            }
        }
    } else if (selectedShape === 'chamfered') {
        const nd = (r2, c2) => r2 >= 0 && r2 < count && c2 >= 0 && c2 < count && isDark(r2, c2);
        const cl = cs * 0.45;
        for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
                if (!isDark(r, c)) continue;
                const x = ox + c * cs, y = oy + r * cs;
                if (checkFP && isFinderPattern(r, c, count)) { ctx.fillRect(x, y, cs, cs); continue; }
                const L = nd(r, c - 1), R = nd(r, c + 1), T = nd(r - 1, c), B = nd(r + 1, c);
                const tl = !T && !L, tr = !T && !R, br = !B && !R, bl = !B && !L;
                ctx.beginPath();
                ctx.moveTo(tl ? x + cl : x, y);
                ctx.lineTo(tr ? x + cs - cl : x + cs, y);
                if (tr) ctx.lineTo(x + cs, y + cl);
                ctx.lineTo(x + cs, br ? y + cs - cl : y + cs);
                if (br) ctx.lineTo(x + cs - cl, y + cs);
                ctx.lineTo(bl ? x + cl : x, y + cs);
                if (bl) ctx.lineTo(x, y + cs - cl);
                ctx.lineTo(x, tl ? y + cl : y);
                if (tl) ctx.lineTo(x + cl, y);
                ctx.closePath();
                ctx.fill();
            }
        }
    } else if (selectedShape === 'jagged') {
        const nd = (r2, c2) => r2 >= 0 && r2 < count && c2 >= 0 && c2 < count && isDark(r2, c2);
        for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
                if (!isDark(r, c)) continue;
                const x = ox + c * cs, y = oy + r * cs;
                if (checkFP && isFinderPattern(r, c, count)) { ctx.fillRect(x, y, cs, cs); continue; }
                const L = nd(r, c - 1), R = nd(r, c + 1), T = nd(r - 1, c), B = nd(r + 1, c);
                ctx.beginPath();
                if (!L && !R && !T && !B) {
                    // isolated: diamond
                    ctx.moveTo(x + cs / 2, y);
                    ctx.lineTo(x + cs, y + cs / 2);
                    ctx.lineTo(x + cs / 2, y + cs);
                    ctx.lineTo(x, y + cs / 2);
                } else if (R && !L && !T && !B) {
                    // horizontal run start: point right ▶
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + cs, y + cs / 2);
                    ctx.lineTo(x, y + cs);
                } else if (L && !R && !T && !B) {
                    // horizontal run end: point left ◀
                    ctx.moveTo(x, y + cs / 2);
                    ctx.lineTo(x + cs, y);
                    ctx.lineTo(x + cs, y + cs);
                } else if (B && !T && !L && !R) {
                    // vertical run start: point down ▼
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + cs, y);
                    ctx.lineTo(x + cs / 2, y + cs);
                } else if (T && !B && !L && !R) {
                    // vertical run end: point up ▲
                    ctx.moveTo(x + cs / 2, y);
                    ctx.lineTo(x + cs, y + cs);
                    ctx.lineTo(x, y + cs);
                } else {
                    ctx.rect(x, y, cs, cs);
                }
                ctx.closePath();
                ctx.fill();
            }
        }
    } else if (selectedShape === 'arcs') {
        // Calligraphic brush-stroke style based on exposed-side count:
        // >=2 neighbors → plain square; 1 neighbor → right-angle triangle w/ curved hyp; 0 neighbors → dian 丶
        const nd = (r2, c2) => r2 >= 0 && r2 < count && c2 >= 0 && c2 < count && isDark(r2, c2);
        for (let row = 0; row < count; row++) {
            for (let col = 0; col < count; col++) {
                if (!isDark(row, col)) continue;
                const x = ox + col * cs, y = oy + row * cs;
                if (checkFP && isFinderPattern(row, col, count)) { ctx.fillRect(x, y, cs, cs); continue; }
                const L = nd(row, col - 1), R = nd(row, col + 1);
                const T = nd(row - 1, col), B = nd(row + 1, col);
                const neighbors = (L?1:0) + (R?1:0) + (T?1:0) + (B?1:0);
                const mx = x + cs / 2, my = y + cs / 2;
                const cv = cs * 0.55;

                if (neighbors >= 2) {
                    // round exposed corners only
                    const ar = cs * 0.25;
                    const tl = !T && !L, tr = !T && !R, br = !B && !R, bl = !B && !L;
                    ctx.beginPath();
                    ctx.moveTo(tl ? x + ar : x, y);
                    ctx.lineTo(tr ? x + cs - ar : x + cs, y);
                    if (tr) ctx.arc(x + cs - ar, y + ar, ar, 3 * Math.PI / 2, 0, false);
                    ctx.lineTo(x + cs, br ? y + cs - ar : y + cs);
                    if (br) ctx.arc(x + cs - ar, y + cs - ar, ar, 0, Math.PI / 2, false);
                    ctx.lineTo(bl ? x + ar : x, y + cs);
                    if (bl) ctx.arc(x + ar, y + cs - ar, ar, Math.PI / 2, Math.PI, false);
                    ctx.lineTo(x, tl ? y + ar : y);
                    if (tl) ctx.arc(x + ar, y + ar, ar, Math.PI, 3 * Math.PI / 2, false);
                    ctx.closePath();
                    ctx.fill();
                } else if (neighbors === 1) {
                    // Right-angle triangle with strongly curved hypotenuse
                    ctx.beginPath();
                    if (B) {
                        ctx.moveTo(x, y);
                        ctx.lineTo(x, y + cs);
                        ctx.lineTo(x + cs, y + cs);
                        ctx.quadraticCurveTo(mx + cv, my, x, y);
                    } else if (T) {
                        ctx.moveTo(x + cs, y + cs);
                        ctx.lineTo(x + cs, y);
                        ctx.lineTo(x, y);
                        ctx.quadraticCurveTo(mx - cv, my, x + cs, y + cs);
                    } else if (R) {
                        ctx.moveTo(x, y);
                        ctx.lineTo(x + cs, y);
                        ctx.lineTo(x + cs, y + cs);
                        ctx.quadraticCurveTo(mx, my + cv, x, y);
                    } else {
                        ctx.moveTo(x + cs, y + cs);
                        ctx.lineTo(x, y + cs);
                        ctx.lineTo(x, y);
                        ctx.quadraticCurveTo(mx, my - cv, x + cs, y + cs);
                    }
                    ctx.closePath();
                    ctx.fill();
                } else {
                    // dian 丶: fat lens along NW-SE diagonal, pointed at both tips
                    ctx.beginPath();
                    ctx.moveTo(x + cs * 0.05, y + cs * 0.05);
                    ctx.quadraticCurveTo(x + cs * 0.92, y + cs * 0.05, x + cs * 0.95, y + cs * 0.95);
                    ctx.quadraticCurveTo(x + cs * 0.08, y + cs * 0.95, x + cs * 0.05, y + cs * 0.05);
                    ctx.fill();
                }
            }
        }
    } else {
        for (let r = 0; r < count; r++)
            for (let c = 0; c < count; c++)
                if (isDark(r, c)) drawModule(ox + c * cs, oy + r * cs, cs, checkFP && isFinderPattern(r, c, count));
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
    drawModules(isDark, count, ox, oy, CELL);
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

    // Corner decoration: collect all positions first, then render with the chosen shape
    // (using drawModules so neighbor-aware shapes like arcs/chamfered/jagged work correctly)
    ctx.fillStyle = '#111';
    const ec = extraCells;
    const cornerSet = new Set();
    for (let row = -ec; row < totalCells + ec; row++) {
        for (let col = -ec; col < totalCells + ec; col++) {
            if (col >= BORDER && col < BORDER + count && row >= BORDER && row < BORDER + count) continue;
            const mx = qrLeft + col * cell;
            const my = qrTop + row * cell;
            if (Math.hypot(mx + cell / 2 - Cx, my + cell / 2 - Cy) > R - cell * 0.25) continue;
            if (!isCornerDot(col, row)) continue;
            cornerSet.add(`${col},${row}`);
        }
    }
    const cRange = totalCells + 2 * ec;
    const cIsDark = (r, c) => cornerSet.has(`${c - ec},${r - ec}`);
    drawModules(cIsDark, cRange, qrLeft - ec * cell, qrTop - ec * cell, cell, false);

    // Actual QR modules
    const ox = qrLeft + BORDER * cell;
    const oy = qrTop  + BORDER * cell;
    drawModules((r, c) => qr.isDark(r, c), count, ox, oy, cell);

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
    if (shape === 'wavy' && !localStorage.getItem('wavyWarnDismissed')) {
        document.getElementById('wavy-modal').style.display = 'flex';
    }
}

function closeWavyModal() {
    if (document.getElementById('wavy-no-show').checked) {
        localStorage.setItem('wavyWarnDismissed', '1');
    }
    document.getElementById('wavy-modal').style.display = 'none';
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
        // Pass a Promise directly to ClipboardItem — required for Safari
        await navigator.clipboard.write([
            new ClipboardItem({ "image/png": new Promise(resolve => canvas.toBlob(resolve)) })
        ]);
    } catch {
        alert("Couldn't copy — try downloading instead.");
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
