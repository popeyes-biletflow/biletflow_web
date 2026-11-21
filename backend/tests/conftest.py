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
# FS-20: unit tests never talk to SMTP unless a test switches it on
os.environ.setdefault("EMAIL_ENABLED", "false")
os.environ.setdefault("EMAIL_PREVIEW_DIR", "")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _offline_notifications(monkeypatch):
    """FS-20 hooks write notifications through notify.db; keep unit tests off the network."""
    from unittest.mock import MagicMock
    import notify

    monkeypatch.setattr(notify, "db", MagicMock())
    yield
