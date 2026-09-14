# FaceTrack — Face Attendance Web App

Flask + SQLite + browser-side face detection (face-api.js). Login, register members, and view your roster with a neon-glass UI.

## Setup

```bash
cd ~/face_web_app
source venv/bin/activate          # venv already exists
python app.py                     # → http://127.0.0.1:5000
```

If you need to reinstall deps:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

## Stack

- **Backend:** Flask 3 + SQLite (file-based, auto-created on first run).
- **Frontend:** Plain HTML / CSS / JS. No build step.
- **Face detection:** [`face-api.js`](https://github.com/justadudewhohacks/face-api.js) loaded from a CDN — models fetched from `justadudewhohacks.github.io/face-api.js/models`.

## Pages

- `/login`, `/register` — auth (passwords hashed with `werkzeug.security.generate_password_hash`).
- `/dashboard` — live camera with bounding boxes + capture form.
- `/members` — card-grid view of every registered member; delete with confirm modal.

## Notes

- Camera data never leaves the browser. The server only stores a 128-dim descriptor + an optional snapshot.
- First load of the dashboard pulls ~6 MB of model weights from the CDN.
- Members are scoped per-user (you only see your own).
