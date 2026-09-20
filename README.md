# 🤖 FaceTrack AI — Face Recognition Attendance System

[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0+-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![face-api.js](https://img.shields.io/badge/face--api.js-SSD--MobileNet--v1-00f5ff?style=for-the-badge)](https://github.com/justadudewhohacks/face-api.js)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)
[![License](https://img.shields.io/badge/License-MIT-green.style=for-the-badge)](LICENSE)

> A modern, browser-native AI facial recognition attendance system with role-based portals (Admin, Teacher, Student), automated CSV reporting, and seamless Vercel serverless deployment.

---

## 🌟 Key Features

### 🧠 Browser-Native AI (Zero Server Webcam Needed)
- **SSD MobileNet V1 Architecture:** Powered by `face-api.js` running 100% on the client side via WebGL/WASM.
- **5-Sample Descriptor Averaging:** High registration precision by capturing 5 fast face snapshots and computing a 128-dimensional averaged vector baseline.
- **Real-Time 500ms Polling:** Detects faces, calculates Euclidean distance, and overlays bounding boxes with confidence scores (`Name (87%)`).
- **Privacy First:** Video streams never leave the user's browser. Only 128-D numerical vectors and optional snapshots are saved.

### 🎭 Role-Based Portals

#### 🛡️ Admin Portal (`/admin`)
- Complete user management & roster control.
- Assign or update user roles (`admin`, `teacher`, `student`) and class sections inline.
- Create teacher accounts and perform user deletions with confirmation modals.

#### 👩‍🏫 Teacher Portal (`/teacher`)
- Daily attendance register filtered by date.
- Real-time student search (Name, USN, Class).
- One-click **CSV Export** (`attendance_YYYY-MM-DD.csv`).
- Visual summary counters (Present, Absent, Total, Attendance Rate %).

#### 🎓 Student Portal (`/student`)
- Personal dashboard with visual SVG attendance progress ring (`%`).
- Visual warning badges for attendance below 75% or high performance above 90%.
- Full date-wise attendance log.
- Self check-in via browser webcam (`/detect`).

---

## 🌐 Live Demo

- **Deployment URL:** [https://face-recognition-attendance-lemon.vercel.app](https://face-recognition-attendance-lemon.vercel.app)
- **Health Check:** [https://face-recognition-attendance-lemon.vercel.app/health](https://face-recognition-attendance-lemon.vercel.app/health)

### 🔐 Default Admin Credentials
```text
Username : admin
Password : admin123
```
*(Note: Change password after first sign-in. Teachers are provisioned by Admin. Students can self-register at `/register`.)*

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, Modern CSS3 (Glassmorphic Signal Theme), JavaScript (ES6+), [`face-api.js`](https://github.com/justadudewhohacks/face-api.js)
- **Backend:** Python 3, Flask 3, Werkzeug (PBKDF2-SHA256 password hashing)
- **Database:** SQLite3 with relational foreign keys (`users`, `detections`, `attendance`)
- **Serverless / Hosting:** Vercel Python Serverless Runtime (`@vercel/python`)

---

## 📁 Directory Structure

```text
face_web_app/
├── api/
│   └── index.py             # Vercel serverless WSGI entry-point
├── static/
│   ├── css/
│   │   ├── style.css        # Base theme & global styles
│   │   ├── landing.css      # AI landing page styling
│   │   ├── login.css        # Split-screen auth layout
│   │   └── portals.css      # Admin/Teacher/Student portal components
│   ├── js/
│   │   ├── detect.js        # SSD MobileNet detection & bounding box loop
│   │   ├── register_face.js # 5-sample face descriptor averaging
│   │   ├── auth.js          # Password strength meter
│   │   └── members.js       # Roster management & deletion AJAX
│   ├── models/              # Pre-trained SSD MobileNet V1 & Face Recognition weights
│   └── captures/            # Local snapshot storage directory (.gitkeep)
├── templates/
│   ├── landing.html         # High-tech product landing page
│   ├── login.html           # Full-screen AI auth login page
│   ├── register.html        # Face capture registration page
│   ├── admin_dashboard.html # Admin user management dashboard
│   ├── admin_create_teacher.html # Teacher creation form
│   ├── teacher_dashboard.html # Attendance register & CSV export
│   ├── student_dashboard.html # Student self-view & attendance ring
│   ├── detect.html          # Camera scanner & detection overlay
│   ├── members.html         # Roster overview
│   └── base.html            # Core layout wrapper with topbar navigation
├── app.py                   # Main Flask backend application & routes
├── requirements.txt         # Production dependencies
├── vercel.json              # Vercel routing & lambda builder config
└── README.md                # Project documentation
```

---

## 🚀 Local Quickstart

### Prerequisites
- Python 3.9 or higher
- Web camera connected to your computer

### 1. Clone the repository & enter workspace
```bash
git clone https://github.com/prajwalprajwalferrao-cloud/face-recognition-attendance.git
cd face-recognition-attendance
```

### 2. Create & activate Virtual Environment
```bash
# macOS / Linux
python3 -m venv venv
source venv/bin/activate

# Windows (Command Prompt)
python -m venv venv
venv\Scripts\activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Start the Flask Application
```bash
python app.py
```
Open your browser and navigate to **[http://127.0.0.1:5050](http://127.0.0.1:5050)**.

---

## ⚡ Deployment on Vercel

This repository is pre-configured for Vercel serverless deployments via `vercel.json` and `api/index.py`.

### Architecture Highlights for Vercel:
1. **Serverless Entry Point:** `api/index.py` re-exports Flask's `app` and sets absolute paths for templates and static assets.
2. **Read-Only Filesystem Handling:** Vercel functions run on a read-only filesystem. `app.py` automatically detects the `VERCEL=1` environment variable and redirects SQLite/captures to `/tmp/`.
3. **Client-Side Camera Capture:** `cv2.VideoCapture()` is **not** used on the server. The client browser captures webcam frames using `navigator.mediaDevices.getUserMedia()` and runs face detection locally.

To deploy your own fork:
```bash
git push origin main
```
Import the repository into your Vercel Dashboard and click **Deploy**.

---

## 📡 API & Route Reference

| Route | Method | Access | Description |
|---|---|---|---|
| `/` | GET | Public | Redirects to `/landing` or `/portal` if logged in |
| `/landing` | GET | Public | AI Product marketing landing page |
| `/login` | GET, POST | Public | User authentication endpoint |
| `/register` | GET, POST | Public | Student account registration with 5-sample face capture |
| `/health` | GET | Public | Serverless health status ping (JSON) |
| `/admin` | GET, POST | Admin | Admin user management portal |
| `/admin/create-teacher` | GET, POST | Admin | Provision teacher accounts |
| `/teacher` | GET | Teacher / Admin | Daily attendance register & filtering |
| `/teacher/attendance/csv` | GET | Teacher / Admin | Download CSV report for selected date |
| `/student` | GET | Student | Student personal attendance dashboard |
| `/detect` | GET | Logged In | Real-time face scanner & check-in page |
| `/api/users` | GET | Logged In | Fetch registered user face descriptors |
| `/api/detect` | POST | Logged In | Log real-time detection event & mark attendance |
| `/api/members/<id>` | DELETE | Admin / Teacher | Remove registered user from system |

---

## 🔒 Security & Privacy

- **Biometric Security:** Raw face images are not required for recognition. The system stores 128-float numerical embeddings (descriptors).
- **Password Hashing:** Passwords are standard PBKDF2-SHA256 hashed before database entry.
- **Route Protections:** Custom Python decorators (`@login_required`, `@role_required`) protect all role-restricted routes.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for details.
