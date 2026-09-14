/**
 * register_face.js
 * Captures 5 face descriptor samples and averages them for a robust baseline.
 * Uses SsdMobilenetv1 to match the detection model.
 */

const video      = document.getElementById("video");
const canvas     = document.getElementById("canvas");
const captureBtn = document.getElementById("capture-btn");
const statusText = document.getElementById("capture-status");
const progressBar = document.getElementById("capture-progress");

const SAMPLES_NEEDED = 5;
let collectedDescriptors = [];

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
        });
        video.srcObject = stream;
    } catch (err) {
        statusText.innerText = "❌ Camera access denied";
        console.error(err);
    }
}

async function loadModels() {
    await faceapi.nets.ssdMobilenetv1.loadFromUri("/static/models");
    await faceapi.nets.faceLandmark68Net.loadFromUri("/static/models");
    await faceapi.nets.faceRecognitionNet.loadFromUri("/static/models");
}

/** Average an array of Float32Array descriptors into one. */
function averageDescriptors(descriptors) {
    const length = descriptors[0].length;
    const avg    = new Float32Array(length);
    for (const desc of descriptors) {
        for (let i = 0; i < length; i++) {
            avg[i] += desc[i];
        }
    }
    for (let i = 0; i < length; i++) {
        avg[i] /= descriptors.length;
    }
    return avg;
}

captureBtn.addEventListener("click", async () => {
    captureBtn.disabled = true;
    collectedDescriptors = [];
    const progressWrap = document.getElementById("progressWrap");
    if (progressWrap) progressWrap.style.display = "block";

    statusText.innerText = `Capturing sample 1 of ${SAMPLES_NEEDED}…`;
    if (progressBar) { progressBar.style.width = "0%"; }

    for (let i = 0; i < SAMPLES_NEEDED; i++) {
        statusText.innerText = `📸 Capturing sample ${i + 1} of ${SAMPLES_NEEDED} — hold still…`;

        const options   = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
        const detection = await faceapi
            .detectSingleFace(video, options)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) {
            statusText.innerText = "❌ No face detected — make sure your face is visible and well-lit.";
            captureBtn.disabled = false;
            return;
        }

        collectedDescriptors.push(detection.descriptor);

        if (progressBar) {
            progressBar.style.width = `${((i + 1) / SAMPLES_NEEDED) * 100}%`;
        }

        // Brief pause between samples for natural variation
        if (i < SAMPLES_NEEDED - 1) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // Average the descriptors
    const avgDescriptor = averageDescriptors(collectedDescriptors);

    // Capture face image
    canvas.width  = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    document.getElementById("face_descriptor").value = JSON.stringify(Array.from(avgDescriptor));
    document.getElementById("face_image").value       = canvas.toDataURL("image/jpeg", 0.8);

    statusText.innerText  = `✅ Face captured successfully (${SAMPLES_NEEDED} samples averaged)`;
    captureBtn.disabled   = false;
    captureBtn.innerText  = "Re-capture";
});

window.addEventListener("load", async () => {
    statusText.innerText = "Loading AI models…";
    await loadModels();

    statusText.innerText = "Starting camera…";
    await startCamera();

    statusText.innerText = "Ready — click 'Capture Face' when ready";
});