"""
Face Recognition Attendance System
Roles: admin | teacher | student
- Admin  : manage users, set roles
- Teacher: view/export attendance by date (CSV)
- Student: view own attendance
"""

import base64
import csv
import io
import json
import os
import sqlite3
import uuid
from datetime import datetime, date, timedelta
from functools import wraps

from flask import (
    Flask,
    flash,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from werkzeug.security import (
    generate_password_hash,
    check_password_hash,
)

_PASSWORD_METHOD = "pbkdf2:sha256"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.db")

CAPTURES_DIR = os.path.join(BASE_DIR, "static", "captures")
os.makedirs(CAPTURES_DIR, exist_ok=True)

app = Flask(__name__)
app.secret_key = os.environ.get("FACE_WEB_SECRET", "change-me-in-production")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB cap


# ─────────────────────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            username       TEXT UNIQUE NOT NULL,
            name           TEXT,
            usn            TEXT,
            role           TEXT NOT NULL DEFAULT 'student',
            class_name     TEXT,
            password_hash  TEXT NOT NULL,
            face_descriptor TEXT,
            face_image     TEXT,
            created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS detections (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER,
            confidence  REAL,
            snapshot    TEXT,
            detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attendance (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            attendance_date TEXT NOT NULL,
            marked_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, attendance_date)
        );
    """)
    conn.commit()

    # ── lightweight migrations ───────────────────────────────
    user_cols = [r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()]

    for col, defn in [
        ("name",       "TEXT"),
        ("usn",        "TEXT"),
        ("role",       "TEXT NOT NULL DEFAULT 'student'"),
        ("class_name", "TEXT"),
    ]:
        if col not in user_cols:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} {defn}")
            conn.commit()

    det_cols = [r["name"] for r in conn.execute("PRAGMA table_info(detections)").fetchall()]
    if "snapshot" not in det_cols:
        conn.execute("ALTER TABLE detections ADD COLUMN snapshot TEXT")
        conn.commit()

    # ── seed default admin account ───────────────────────────
    existing = conn.execute(
        "SELECT id FROM users WHERE username = 'admin'"
    ).fetchone()
    if not existing:
        conn.execute(
            """
            INSERT INTO users (username, name, role, password_hash)
            VALUES ('admin', 'Administrator', 'admin', ?)
            """,
            (generate_password_hash("admin123", method=_PASSWORD_METHOD),),
        )
        conn.commit()

    conn.close()


init_db()


# ─────────────────────────────────────────────────────────────
# DECORATORS
# ─────────────────────────────────────────────────────────────

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


def role_required(*roles):
    """Require one of the given roles. Must be applied AFTER @login_required."""
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if session.get("role") not in roles:
                flash("Access denied.", "error")
                return redirect(url_for("portal_redirect"))
            return view(*args, **kwargs)
        return wrapped
    return decorator


# ─────────────────────────────────────────────────────────────
# HOME / PORTAL REDIRECT
# ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if "user_id" in session:
        return redirect(url_for("portal_redirect"))
    return redirect(url_for("login"))


@app.route("/portal")
@login_required
def portal_redirect():
    role = session.get("role", "student")
    if role == "admin":
        return redirect(url_for("admin_dashboard"))
    elif role == "teacher":
        return redirect(url_for("teacher_dashboard"))
    else:
        return redirect(url_for("student_dashboard"))


# ─────────────────────────────────────────────────────────────
# REGISTER  (students self-register)
# ─────────────────────────────────────────────────────────────

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username       = (request.form.get("username") or "").strip()
        name           = (request.form.get("name")     or "").strip()
        usn            = (request.form.get("usn")      or "").strip()
        class_name     = (request.form.get("class_name") or "").strip()
        password       = (request.form.get("password") or "")
        confirm        = (request.form.get("confirm")  or "")
        face_descriptor = request.form.get("face_descriptor")
        face_image      = request.form.get("face_image")

        errors = []
        if not username:       errors.append("Username required.")
        if not name:           errors.append("Full name required.")
        if not usn:            errors.append("USN required.")
        if len(password) < 6:  errors.append("Password must be ≥ 6 characters.")
        if password != confirm: errors.append("Passwords do not match.")
        if not face_descriptor: errors.append("Capture your face first.")

        if errors:
            for e in errors:
                flash(e, "error")
            return render_template("register.html")

        conn = get_db()
        try:
            conn.execute(
                """
                INSERT INTO users
                  (username, name, usn, class_name, role, password_hash,
                   face_descriptor, face_image)
                VALUES (?, ?, ?, ?, 'student', ?, ?, ?)
                """,
                (username, name, usn, class_name,
                 generate_password_hash(password, method=_PASSWORD_METHOD),
                 face_descriptor, face_image),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            flash("Username already exists.", "error")
            return render_template("register.html")

        conn.close()
        flash("Registration successful! Please sign in.", "success")
        return redirect(url_for("login"))

    return render_template("register.html")


# ─────────────────────────────────────────────────────────────
# LOGIN / LOGOUT
# ─────────────────────────────────────────────────────────────

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = (request.form.get("password") or "")

        conn = get_db()
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        conn.close()

        if row and check_password_hash(row["password_hash"], password):
            session["user_id"]  = row["id"]
            session["username"] = row["username"]
            session["name"]     = row["name"] or row["username"]
            session["role"]     = row["role"]
            return redirect(url_for("portal_redirect"))

        flash("Invalid credentials.", "error")

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ─────────────────────────────────────────────────────────────
# DETECT (student / any logged-in user)
# ─────────────────────────────────────────────────────────────

@app.route("/detect")
@login_required
def detect():
    return render_template("detect.html")


# ─────────────────────────────────────────────────────────────
# ══════════════════  ADMIN PORTAL  ═══════════════════════════
# ─────────────────────────────────────────────────────────────

@app.route("/admin")
@login_required
@role_required("admin")
def admin_dashboard():
    conn = get_db()

    users = conn.execute(
        "SELECT id, username, name, usn, class_name, role, created_at FROM users ORDER BY role, name"
    ).fetchall()

    today = date.today().isoformat()
    present_today = conn.execute(
        "SELECT COUNT(*) FROM attendance WHERE attendance_date = ?", (today,)
    ).fetchone()[0]

    total_students = conn.execute(
        "SELECT COUNT(*) FROM users WHERE role = 'student'"
    ).fetchone()[0]

    total_teachers = conn.execute(
        "SELECT COUNT(*) FROM users WHERE role = 'teacher'"
    ).fetchone()[0]

    conn.close()

    return render_template(
        "admin_dashboard.html",
        users=users,
        present_today=present_today,
        total_students=total_students,
        total_teachers=total_teachers,
        today=today,
    )


@app.route("/admin/set-role", methods=["POST"])
@login_required
@role_required("admin")
def admin_set_role():
    user_id  = request.form.get("user_id")
    new_role = request.form.get("role")
    class_name = (request.form.get("class_name") or "").strip()

    if new_role not in ("admin", "teacher", "student"):
        flash("Invalid role.", "error")
        return redirect(url_for("admin_dashboard"))

    conn = get_db()
    conn.execute(
        "UPDATE users SET role = ?, class_name = ? WHERE id = ?",
        (new_role, class_name, user_id),
    )
    conn.commit()
    conn.close()

    flash("Role updated successfully.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/delete-user", methods=["POST"])
@login_required
@role_required("admin")
def admin_delete_user():
    user_id = request.form.get("user_id")

    if str(user_id) == str(session["user_id"]):
        flash("Cannot delete your own account.", "error")
        return redirect(url_for("admin_dashboard"))

    conn = get_db()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()

    flash("User deleted.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/create-teacher", methods=["GET", "POST"])
@login_required
@role_required("admin")
def admin_create_teacher():
    if request.method == "POST":
        username   = (request.form.get("username")   or "").strip()
        name       = (request.form.get("name")       or "").strip()
        class_name = (request.form.get("class_name") or "").strip()
        password   = (request.form.get("password")   or "")

        if not username or not name or len(password) < 6:
            flash("Fill all fields (password ≥ 6 chars).", "error")
            return render_template("admin_create_teacher.html")

        conn = get_db()
        try:
            conn.execute(
                """
                INSERT INTO users (username, name, class_name, role, password_hash)
                VALUES (?, ?, ?, 'teacher', ?)
                """,
                (username, name, class_name,
                 generate_password_hash(password, method=_PASSWORD_METHOD)),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            flash("Username already exists.", "error")
            return render_template("admin_create_teacher.html")

        conn.close()
        flash(f"Teacher '{username}' created successfully.", "success")
        return redirect(url_for("admin_dashboard"))

    return render_template("admin_create_teacher.html")


# ─────────────────────────────────────────────────────────────
# ══════════════════  TEACHER PORTAL  ═════════════════════════
# ─────────────────────────────────────────────────────────────

@app.route("/teacher")
@login_required
@role_required("teacher", "admin")
def teacher_dashboard():
    selected_date = request.args.get("date", date.today().isoformat())

    conn = get_db()

    # All students with whether they were present on selected_date
    rows = conn.execute(
        """
        SELECT
            u.id,
            u.name,
            u.usn,
            u.class_name,
            u.username,
            u.face_image,
            a.marked_at AS marked_at
        FROM users u
        LEFT JOIN attendance a
            ON u.id = a.user_id AND a.attendance_date = ?
        WHERE u.role = 'student'
        ORDER BY u.class_name, u.name
        """,
        (selected_date,),
    ).fetchall()

    conn.close()

    present_count = sum(1 for r in rows if r["marked_at"])
    total_count   = len(rows)

    attendance_list = [
        {
            "id":         r["id"],
            "name":       r["name"] or r["username"],
            "usn":        r["usn"],
            "class_name": r["class_name"],
            "face_image": r["face_image"],
            "is_present": r["marked_at"] is not None,
            "marked_at":  r["marked_at"],
        }
        for r in rows
    ]

    return render_template(
        "teacher_dashboard.html",
        attendance_list=attendance_list,
        selected_date=selected_date,
        present_count=present_count,
        total_count=total_count,
        absent_count=total_count - present_count,
    )


@app.route("/teacher/attendance/csv")
@login_required
@role_required("teacher", "admin")
def teacher_export_csv():
    selected_date = request.args.get("date", date.today().isoformat())

    conn = get_db()
    rows = conn.execute(
        """
        SELECT
            u.name,
            u.usn,
            u.class_name,
            u.username,
            CASE WHEN a.marked_at IS NOT NULL THEN 'Present' ELSE 'Absent' END AS status,
            a.marked_at
        FROM users u
        LEFT JOIN attendance a
            ON u.id = a.user_id AND a.attendance_date = ?
        WHERE u.role = 'student'
        ORDER BY u.class_name, u.name
        """,
        (selected_date,),
    ).fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "USN", "Class", "Username", "Status", "Time Marked"])
    for r in rows:
        writer.writerow([
            r["name"] or r["username"],
            r["usn"] or "",
            r["class_name"] or "",
            r["username"],
            r["status"],
            r["marked_at"] or "",
        ])

    csv_data = output.getvalue()
    response = make_response(csv_data)
    response.headers["Content-Disposition"] = (
        f'attachment; filename="attendance_{selected_date}.csv"'
    )
    response.headers["Content-Type"] = "text/csv"
    return response


# ─────────────────────────────────────────────────────────────
# ══════════════════  STUDENT PORTAL  ═════════════════════════
# ─────────────────────────────────────────────────────────────

@app.route("/student")
@login_required
@role_required("student")
def student_dashboard():
    uid = session["user_id"]
    conn = get_db()

    # Profile
    user = conn.execute(
        "SELECT name, usn, class_name, face_image FROM users WHERE id = ?", (uid,)
    ).fetchone()

    # All attendance records for this student
    records = conn.execute(
        """
        SELECT attendance_date, marked_at
        FROM attendance
        WHERE user_id = ?
        ORDER BY attendance_date DESC
        """,
        (uid,),
    ).fetchall()

    # Total working days = distinct days any student was marked present
    total_days_row = conn.execute(
        "SELECT COUNT(DISTINCT attendance_date) FROM attendance"
    ).fetchone()
    total_days = total_days_row[0] or 1  # avoid division by zero

    present_days = len(records)
    percentage   = round((present_days / total_days) * 100, 1) if total_days else 0

    conn.close()

    return render_template(
        "student_dashboard.html",
        user=user,
        records=records,
        present_days=present_days,
        total_days=total_days,
        percentage=percentage,
    )


# ─────────────────────────────────────────────────────────────
# LEGACY PAGES (kept for backward compat / admin use)
# ─────────────────────────────────────────────────────────────

@app.route("/attendance")
@login_required
@role_required("admin", "teacher")
def attendance():
    conn = get_db()
    today = date.today().isoformat()
    rows = conn.execute(
        """
        SELECT u.id, u.name, u.usn, u.username, u.face_image,
               a.marked_at AS today_marked_at
        FROM users u
        LEFT JOIN attendance a ON u.id = a.user_id AND a.attendance_date = ?
        WHERE u.role = 'student'
        ORDER BY u.name, u.username
        """,
        (today,),
    ).fetchall()
    conn.close()

    present_count = sum(1 for r in rows if r["today_marked_at"])
    attendance_list = [
        {
            "id":         r["id"],
            "name":       r["name"] or r["username"],
            "usn":        r["usn"],
            "face_image": r["face_image"],
            "is_present": r["today_marked_at"] is not None,
            "marked_at":  r["today_marked_at"],
        }
        for r in rows
    ]

    return render_template(
        "attendance.html",
        attendance_list=attendance_list,
        today=today,
        present_count=present_count,
        total_count=len(attendance_list),
    )


@app.route("/members")
@login_required
@role_required("admin", "teacher")
def members():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT u.id, u.username, u.name, u.face_image,
               MAX(d.detected_at) AS last_seen,
               COUNT(d.id) AS total_detection
        FROM users u
        LEFT JOIN detections d ON u.id = d.user_id
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY u.username
        """
    ).fetchall()
    conn.close()

    members_list = [
        {
            "id":              r["id"],
            "name":            r["name"] or r["username"],
            "face_image":      r["face_image"],
            "last_seen":       r["last_seen"],
            "total_detection": r["total_detection"],
        }
        for r in rows
    ]
    return render_template("members.html", members=members_list)


@app.route("/history")
@login_required
@role_required("admin", "teacher")
def history():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT u.username, u.name, d.confidence, d.detected_at
        FROM detections d
        JOIN users u ON d.user_id = u.id
        ORDER BY d.detected_at DESC
        """
    ).fetchall()
    conn.close()
    return render_template("history.html", rows=rows)


@app.route("/api/members/<int:user_id>", methods=["DELETE"])
@login_required
@role_required("admin", "teacher")
def api_delete_member(user_id):
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────
# API  ── users / detect / recent-detections
# ─────────────────────────────────────────────────────────────

@app.route("/api/users")
@login_required
def api_users():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT id, username, name, usn, face_descriptor, face_image
        FROM users
        WHERE face_descriptor IS NOT NULL
        """
    ).fetchall()
    conn.close()

    return jsonify([
        {
            "id":         r["id"],
            "name":       r["name"] or r["username"],
            "username":   r["username"],
            "usn":        r["usn"],
            "descriptor": json.loads(r["face_descriptor"]),
            "image":      r["face_image"],
        }
        for r in rows
    ])


@app.route("/api/detect", methods=["POST"])
@login_required
def api_detect():
    data               = request.get_json()
    user_id            = data.get("user_id")
    confidence         = data.get("confidence")
    snapshot_data_url  = data.get("snapshot")

    snapshot_filename = None
    if snapshot_data_url:
        try:
            header, encoded = snapshot_data_url.split(",", 1)
            ext = "png" if "png" in header else "jpg"
            snapshot_filename = (
                f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"
            )
            with open(os.path.join(CAPTURES_DIR, snapshot_filename), "wb") as f:
                f.write(base64.b64decode(encoded))
        except Exception:
            snapshot_filename = None

    conn = get_db()
    conn.execute(
        "INSERT INTO detections (user_id, confidence, snapshot) VALUES (?, ?, ?)",
        (user_id, confidence, snapshot_filename),
    )

    if user_id:
        today = date.today().isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO attendance (user_id, attendance_date) VALUES (?, ?)",
            (user_id, today),
        )

    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/recent-detections")
@login_required
def api_recent_detections():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT d.id, d.confidence, d.snapshot, d.detected_at, u.username, u.name
        FROM detections d
        LEFT JOIN users u ON d.user_id = u.id
        ORDER BY d.detected_at DESC
        LIMIT 12
        """
    ).fetchall()
    conn.close()

    return jsonify([
        {
            "id":         r["id"],
            "name":       r["name"] or r["username"] or "Unknown",
            "is_unknown": r["username"] is None,
            "confidence": r["confidence"],
            "snapshot": (
                url_for("static", filename=f"captures/{r['snapshot']}")
                if r["snapshot"] else None
            ),
            "detected_at": r["detected_at"],
        }
        for r in rows
    ])


# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)