# api/index.py
# Vercel Python serverless entry-point.
# Vercel looks for a callable named `app` in this file.

from app import app  # noqa: F401  — re-export the Flask app object
