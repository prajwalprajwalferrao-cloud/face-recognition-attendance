# api/index.py — Vercel Python serverless entry-point
#
# @vercel/python looks for a WSGI callable named `app` in this file.
# Flask serves templates AND static files (CSS/JS/images/models) itself,
# so ALL routes — including /static/* — flow through here.

import os
import sys

# ── Make sure the project root is on the Python path ─────────────────────────
# api/ is one level below the project root, so go up one directory.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# ── Import the Flask app ──────────────────────────────────────────────────────
from app import app  # noqa: F401

# ── Guarantee Flask finds templates and static on Vercel ─────────────────────
# Flask resolves these relative to the module that created the app (app.py).
# On Vercel the working directory may differ, so pin absolute paths.
app.template_folder = os.path.join(_ROOT, "templates")
app.static_folder   = os.path.join(_ROOT, "static")
app.static_url_path = "/static"
