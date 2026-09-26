/**
 * detect.js — Face recognition with SsdMobilenetv1
 *
 * Coordinate system:
 *   - <video> has CSS transform: scaleX(-1)  → displayed mirrored (selfie view)
 *   - <canvas> has NO CSS transform           → raw coordinate space
 *   - face-api detects on raw video pixels    → coords are in unmirrored space
 *
 * To draw a box that overlays correctly on the mirrored video:
 *   flippedX = canvasWidth - box.x - box.width
 *
 * Text is drawn normally (canvas is not mirrored) so it reads left-to-right.
 */

const video       = document.getElementById("video");
const overlay     = document.getElementById("overlay");
const resultText  = document.getElementById("result");
const resultPanel = document.getElementById("resultPanel");
const resultPhoto = document.getElementById("resultPhoto");
const resultName  = document.getElementById("resultName");
const recentList  = document.getElementById("recentList");

let users        = [];
let trackedFaces = [];

// ── Tracking: are two boxes the same person still in frame? ──────────────
function boxLooksLikeSamePerson(a, b) {
    if (!a || !b) return false;
    const threshold = Math.max(a.width, a.height) * 0.55;
    return (
        Math.abs(a.x - b.x) < threshold &&
        Math.abs(a.y - b.y) < threshold &&
        Math.abs(a.width - b.width) < threshold
    );
}

// ── Model loading ─────────────────────────────────────────────────────────
async function loadModels() {
    const MODEL_URL = "/static/models";
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
}

// ── Camera ────────────────────────────────────────────────────────────────
async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
    });
    video.srcObject = stream;
    return new Promise(resolve => { video.onloadedmetadata = () => resolve(); });
}

// ── Load known faces from server ─────────────────────────────────────────
async function loadUsers() {
    const res = await fetch("/api/users");
    users = await res.json();
}

// ── Canvas overlay helpers ────────────────────────────────────────────────
function syncOverlaySize() {
    // Keep canvas buffer exactly the same size as the video frame.
    // Do NOT set this inside clearOverlay to avoid redundant resets.
    if (overlay.width  !== video.videoWidth)  overlay.width  = video.videoWidth;
    if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
}

function clearOverlay() {
    overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
}

/**
 * drawBox — draw a labelled bounding box on the canvas.
 *
 * face-api returns coordinates in the UNMIRRORED video pixel space.
 * The canvas has NO CSS transform, so we manually flip X so the box
 * appears over the correct face position in the CSS-mirrored video.
 *
 *   flippedX = canvasWidth - box.x - box.width
 */
function drawBox(box, color, label) {
    const ctx = overlay.getContext("2d");
    const W   = overlay.width;

    // Flip X to match the CSS-mirrored video
    const flippedX = W - box.x - box.width;

    // ── Border rect ────────────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 8;
    ctx.strokeRect(flippedX, box.y, box.width, box.height);
    ctx.restore();

    // ── Label background + text ────────────────────────────────────────────
    const labelY    = box.y > 32 ? box.y - 10 : box.y + box.height + 22;
    const labelX    = flippedX;
    const padding   = 6;
    const fontSize  = 14;

    ctx.save();
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;

    // Background pill
    const textW = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(labelX, labelY - fontSize - padding / 2,
                  textW + padding * 2, fontSize + padding, 4);
    ctx.fill();

    // Text — drawn normally (canvas not CSS-mirrored) so it reads correctly
    ctx.globalAlpha = 1;
    ctx.fillStyle   = "#000";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, labelX + padding, labelY);
    ctx.restore();
}

// ── Match result panel ────────────────────────────────────────────────────
function showMatch(name, photoSrc) {
    resultPanel.style.display = "block";
    resultName.innerText = name;
    resultPhoto.src = photoSrc;
}
function hideMatch() {
    resultPanel.style.display = "none";
}

// ── Snapshot (mirrored, matching what the user sees) ─────────────────────
function captureSnapshot() {
    const c   = document.createElement("canvas");
    c.width   = video.videoWidth;
    c.height  = video.videoHeight;
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    return c.toDataURL("image/jpeg", 0.75);
}

// ── Recent detection cards ────────────────────────────────────────────────
function addRecentCard(name, isUnknown, snapshotSrc) {
    if (!recentList) return;
    const card = document.createElement("div");
    card.className = "recent-card " + (isUnknown ? "unknown" : "match");

    const img = document.createElement("img");
    img.src = snapshotSrc || "/static/img/unknown-placeholder.png";
    img.onerror = () => { img.style.display = "none"; };

    const span = document.createElement("span");
    span.innerText = name;

    card.appendChild(img);
    card.appendChild(span);
    recentList.prepend(card);

    while (recentList.children.length > 12) {
        recentList.removeChild(recentList.lastChild);
    }
}

async function loadRecentDetections() {
    if (!recentList) return;
    try {
        const res  = await fetch("/api/recent-detections");
        const rows = await res.json();
        recentList.innerHTML = "";
        rows.forEach(r => addRecentCard(
            r.name, r.is_unknown,
            r.snapshot || "/static/img/unknown-placeholder.png"
        ));
    } catch (e) {
        console.warn("recent-detections fetch failed:", e);
    }
}

// ── Tracking helpers ──────────────────────────────────────────────────────
function findTracked(key, box) {
    return trackedFaces.find(t => t.key === key && boxLooksLikeSamePerson(t.box, box));
}

function logDetection(userId, name, isUnknown, confidence, box) {
    const key      = isUnknown ? "unknown" : `user:${userId}`;
    const existing = findTracked(key, box);

    if (existing) {
        existing.box = box;
        existing.seenThisFrame = true;
        return;
    }

    trackedFaces.push({ key, box, seenThisFrame: true });

    const snapshot = captureSnapshot();
    addRecentCard(name, isUnknown, snapshot);

    fetch("/api/detect", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            user_id:    isUnknown ? null : userId,
            confidence: confidence,
            snapshot:   snapshot,
        }),
    });
}

// ── Core recognition loop ─────────────────────────────────────────────────
async function recognize() {
    // minConfidence: 0.4 — detects faces even in slightly poor lighting
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 });

    const detections = await faceapi
        .detectAllFaces(video, options)
        .withFaceLandmarks()
        .withFaceDescriptors();

    clearOverlay();

    if (!detections || detections.length === 0) {
        resultText.innerHTML = "Waiting for face…";
        hideMatch();
        trackedFaces = [];
        return;
    }

    syncOverlaySize();

    // Resize detection results to match the canvas/video native resolution
    const displaySize = { width: overlay.width, height: overlay.height };
    faceapi.matchDimensions(overlay, displaySize);
    const resizedList = faceapi.resizeResults(detections, displaySize);

    trackedFaces.forEach(t => { t.seenThisFrame = false; });

    let anyMatchShown = false;

    resizedList.forEach(resized => {
        let bestUser     = null;
        let bestDistance = Infinity;

        for (const user of users) {
            const dist = faceapi.euclideanDistance(resized.descriptor, user.descriptor);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestUser     = user;
            }
        }

        const box = resized.detection.box;

        // Threshold 0.50 — balanced between accuracy and recognition rate.
        // Lower value = stricter (fewer false positives).
        // Raise toward 0.55 if known faces are showing as Unknown.
        const MATCH_THRESHOLD = 0.50;

        if (bestUser && bestDistance < MATCH_THRESHOLD) {
            const conf = parseFloat((1 - bestDistance).toFixed(3));
            drawBox(box, "#3ee6d0", `${bestUser.name}  ${Math.round(conf * 100)}%`);
            showMatch(bestUser.name, bestUser.image || "/static/img/unknown-placeholder.png");
            anyMatchShown = true;
            logDetection(bestUser.id, bestUser.name, false, conf, box);
        } else {
            drawBox(box, "#e8556b", "Unknown");
            logDetection(null, "Unknown", true, 0, box);
        }
    });

    resultText.innerHTML =
        resizedList.length > 1
            ? `${resizedList.length} faces detected`
            : (anyMatchShown ? "✅ Recognized" : "❌ Unknown Face");

    if (!anyMatchShown) hideMatch();

    trackedFaces = trackedFaces.filter(t => t.seenThisFrame);
}

// ── Init ──────────────────────────────────────────────────────────────────
window.addEventListener("load", async () => {
    resultText.innerHTML = "Loading AI models…";
    await loadModels();

    resultText.innerHTML = "Starting camera…";
    await startCamera();

    // Wait one frame so video dimensions are available
    await new Promise(r => video.addEventListener("loadeddata", r, { once: true }));
    syncOverlaySize();

    await loadUsers();
    await loadRecentDetections();

    resultText.innerHTML = "Ready — scanning…";
    setInterval(recognize, 500);
});