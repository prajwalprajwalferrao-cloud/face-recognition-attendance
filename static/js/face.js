/* face.js — camera, model load, live detection, capture */
(function () {
  'use strict';

  const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
  const DETECT_INTERVAL_MS = 400;

  const video       = document.getElementById('video');
  const overlay     = document.getElementById('overlay');
  const loaderEl    = document.getElementById('model-loader');
  const camStatusEl = document.getElementById('cam-status');
  const statusText  = camStatusEl && camStatusEl.querySelector('.status-text');
  const statFaces   = document.getElementById('stat-faces');
  const statDet     = document.getElementById('stat-detector');
  const statFrame   = document.getElementById('stat-frame');

  const form        = document.getElementById('capture-form');
  const captureBtn  = document.getElementById('capture-btn');
  const captureStat = document.getElementById('capture-status');

  let lastDescriptor = null;
  let lastSnapshot   = null;
  let frameCount     = 0;
  let detecting      = false;
  let timer          = null;

  // ---------- Toast helper (reused across pages) ----------
  window.toast = function (message, kind = 'info') {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3400);
  };

  // ---------- Model loading ----------
  async function loadModels() {
    if (typeof faceapi === 'undefined') {
      setStatus('face-api.js failed to load', 'error');
      loaderEl.querySelector('div').textContent = 'Failed to load face-api.js (check internet).';
      return false;
    }
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      statDet.textContent = 'Tiny';
      return true;
    } catch (err) {
      console.error(err);
      loaderEl.querySelector('div').textContent = 'Model load failed: ' + err.message;
      return false;
    }
  }

  // ---------- Camera ----------
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      setStatus('Camera live', 'ok');
      sizeCanvas();
    } catch (err) {
      console.error(err);
      setStatus('Camera blocked', 'error');
      toast('Camera permission denied. Allow it in browser settings.', 'error');
    }
  }

  function setStatus(text, kind) {
    if (!statusText) return;
    statusText.textContent = text;
    const dot = camStatusEl.querySelector('.dot');
    dot.classList.remove('ok', 'error');
    if (kind === 'ok')    dot.classList.add('ok');
    if (kind === 'error') dot.classList.add('error');
  }

  function sizeCanvas() {
    overlay.width  = video.videoWidth  || 960;
    overlay.height = video.videoHeight || 540;
    const rect = video.getBoundingClientRect();
    overlay.style.width  = rect.width  + 'px';
    overlay.style.height = rect.height + 'px';
  }

  window.addEventListener('resize', sizeCanvas);

  // ---------- Drawing ----------
  function drawBoxes(faces) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const sx = overlay.width  / video.videoWidth;
    const sy = overlay.height / video.videoHeight;

    faces.forEach((f, i) => {
      const { x, y, width, height } = f.detection.box;
      const X = x * sx, Y = y * sy, W = width * sx, H = height * sy;

      // Glowing rectangle
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur  = 18;
      ctx.strokeStyle = '#00f5ff';
      ctx.lineWidth   = 2;
      ctx.strokeRect(X, Y, W, H);
      ctx.shadowBlur  = 0;

      // Corner brackets
      const corner = 16, t = 3;
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = t;
      drawCorner(ctx, X, Y, corner, 'tl');
      drawCorner(ctx, X + W, Y, corner, 'tr');
      drawCorner(ctx, X, Y + H, corner, 'bl');
      drawCorner(ctx, X + W, Y + H, corner, 'br');

      // Label
      const label = `Face #${i + 1}  •  ${(f.detection.score * 100).toFixed(0)}%`;
      ctx.font = '600 13px Inter, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0, 245, 255, 0.85)';
      ctx.fillRect(X, Y - 24, tw + 14, 22);
      ctx.fillStyle = '#0b0a1f';
      ctx.fillText(label, X + 7, Y - 8);
    });
  }

  function drawCorner(ctx, x, y, len, pos) {
    ctx.beginPath();
    if (pos === 'tl') { ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); }
    if (pos === 'tr') { ctx.moveTo(x - len, y); ctx.lineTo(x, y); ctx.lineTo(x, y + len); }
    if (pos === 'bl') { ctx.moveTo(x, y - len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); }
    if (pos === 'br') { ctx.moveTo(x - len, y); ctx.lineTo(x, y); ctx.lineTo(x, y - len); }
    ctx.stroke();
  }

  // ---------- Detection loop ----------
  async function detectLoop() {
    if (detecting) return;
    detecting = true;
    try {
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
      const result = await faceapi
        .detectAllFaces(video, opts)
        .withFaceLandmarks()
        .withFaceDescriptors();
      drawBoxes(result);
      statFaces.textContent = result.length;
      frameCount += 1;
      statFrame.textContent = frameCount;

      if (result.length > 0) {
        lastDescriptor = Array.from(result[0].descriptor);
        lastSnapshot   = snapshotFromVideo();
        captureBtn.disabled = false;
        updateCaptureStatus('ready');
      } else {
        captureBtn.disabled = true;
        updateCaptureStatus('waiting');
      }
    } catch (err) {
      console.error('detect error', err);
    } finally {
      detecting = false;
    }
  }

  function snapshotFromVideo() {
    const c = document.createElement('canvas');
    c.width  = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return c.toDataURL('image/png');
  }

  function updateCaptureStatus(kind) {
    if (!captureStat) return;
    captureStat.classList.remove('ready', 'waiting');
    captureStat.classList.add(kind);
    const span = captureStat.querySelector('span:last-child');
    if (kind === 'ready')   span.textContent = 'Face detected. You can capture now.';
    if (kind === 'waiting') span.textContent = 'Position your face in view, then press capture.';
    if (kind === 'saving')  span.textContent = 'Saving member…';
  }

  // ---------- Capture submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!lastDescriptor) {
      toast('No face detected yet — try again.', 'error');
      return;
    }
    const fd = new FormData(form);
    updateCaptureStatus('saving');
    captureBtn.disabled = true;

    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fd.get('name'),
          email: fd.get('email'),
          phone: fd.get('phone'),
          role: fd.get('role'),
          face_descriptor: lastDescriptor,
          face_image: lastSnapshot,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');
      toast(`Saved “${fd.get('name')}” to the roster.`, 'success');
      form.reset();
      lastDescriptor = null;
      lastSnapshot   = null;
      updateCaptureStatus('waiting');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Save failed', 'error');
      captureBtn.disabled = false;
    }
  });

  // ---------- Boot ----------
  (async () => {
    if (!video) return;
    await startCamera();
    const ok = await loadModels();
    if (ok) {
      loaderEl.style.display = 'none';
      timer = setInterval(detectLoop, DETECT_INTERVAL_MS);
      detectLoop();
    }
  })();
})();
