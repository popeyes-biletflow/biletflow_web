"""conftest.py — shared fixtures for PB-16 tests.

Adds the backend directory to sys.path so that the backend modules are
importable without installing the package.
"""
import sys
import os

# Make backend/ importable as the root package directory
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Set dummy env vars before any module-level Supabase clients are created
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
