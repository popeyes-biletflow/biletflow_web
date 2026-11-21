"""FS-16: auth lifecycle endpoints. Supabase Auth (gotrue) is mocked."""
import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("QR_SECRET", "test-secret")

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

import main
from main import app
from deps import get_current_user
from schemas import CurrentUser

client = TestClient(app)

SESSION = {
    "access_token": "new-access",
    "refresh_token": "new-refresh",
    "expires_in": 3600,
    "user": {"id": "user-1", "email": "demo@example.com"},
}


def no_suspension():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"is_suspended": False}]
    return db


def test_signup_sends_redirect_and_name():
    fake = AsyncMock(return_value=(200, {"id": "user-1", "email": "demo@example.com", "email_confirmed_at": None}))
    with patch.object(main, "gotrue", fake):
        r = client.post("/api/auth/signup", json={"email": "demo@example.com", "password": "secret123", "full_name": "Demo"})
    assert r.status_code == 201
    assert r.json()["email_confirmation_required"] is True
    assert r.json()["verification_link"] is None
    method, path, body = fake.call_args.args[:3]
    assert (method, path) == ("POST", "/signup")
    assert body["data"] == {"full_name": "Demo"}
    assert fake.call_args.kwargs["params"]["redirect_to"].endswith("/auth/callback")


def test_signup_error_is_passed_through():
    fake = AsyncMock(return_value=(422, {"msg": "Password should be at least 6 characters"}))
    with patch.object(main, "gotrue", fake):
        r = client.post("/api/auth/signup", json={"email": "demo@example.com", "password": "1"})
    assert r.status_code == 422
    assert "Password" in r.json()["detail"]


def test_login_success_returns_tokens():
    with patch.object(main, "gotrue", AsyncMock(return_value=(200, SESSION))), \
         patch.object(main, "supabase", no_suspension()):
        r = client.post("/api/auth/login", json={"email": "demo@example.com", "password": "secret123"})
    assert r.status_code == 200
    assert r.json()["access_token"] == "new-access"
    assert r.json()["refresh_token"] == "new-refresh"


def test_failed_login_returns_no_tokens():
    fake = AsyncMock(return_value=(400, {"error": "invalid_grant", "error_description": "Invalid login credentials"}))
    with patch.object(main, "gotrue", fake):
        r = client.post("/api/auth/login", json={"email": "demo@example.com", "password": "wrong"})
    assert r.status_code == 401
    assert "access_token" not in r.json()


def test_login_unconfirmed_email_has_own_code():
    fake = AsyncMock(return_value=(400, {"error_code": "email_not_confirmed", "msg": "Email not confirmed"}))
    with patch.object(main, "gotrue", fake):
        r = client.post("/api/auth/login", json={"email": "demo@example.com", "password": "secret123"})
    assert r.status_code == 403
    assert r.json()["detail"] == "EMAIL_NOT_CONFIRMED"


def test_refresh_ok_and_expired():
    with patch.object(main, "gotrue", AsyncMock(return_value=(200, SESSION))):
        r = client.post("/api/auth/refresh", json={"refresh_token": "old"})
    assert r.status_code == 200
    assert r.json()["access_token"] == "new-access"

    with patch.object(main, "gotrue", AsyncMock(return_value=(400, {"error": "invalid_grant"}))):
        r = client.post("/api/auth/refresh", json={"refresh_token": "old"})
    assert r.status_code == 401


def test_reset_request_does_not_reveal_accounts():
    fake = AsyncMock(return_value=(200, {}))
    with patch.object(main, "gotrue", fake):
        r = client.post("/api/auth/reset-password", json={"email": "Nobody@Example.com"})
    assert r.status_code == 200
    assert fake.call_args.args[2] == {"email": "nobody@example.com"}
    assert fake.call_args.kwargs["params"]["redirect_to"].endswith("/auth/reset-password")


def test_reset_confirm_sets_password_with_recovery_token():
    fake = AsyncMock(return_value=(200, {"id": "user-1"}))
    with patch.object(main, "gotrue", fake):
        r = client.post("/api/auth/reset-password/confirm", json={"token": "recovery-access", "new_password": "brand-new"})
    assert r.status_code == 200
    assert fake.call_args.args[:3] == ("PUT", "/user", {"password": "brand-new"})
    assert fake.call_args.kwargs["token"] == "recovery-access"


def test_reset_confirm_expired_link():
    with patch.object(main, "gotrue", AsyncMock(return_value=(401, {"msg": "expired"}))):
        r = client.post("/api/auth/reset-password/confirm", json={"token": "old", "new_password": "brand-new"})
    assert r.status_code == 401


def test_verify_requires_token_and_reports_status():
    assert client.get("/api/auth/verify").status_code == 400
    with patch.object(main, "gotrue", AsyncMock(return_value=(200, {"id": "u", "email_confirmed_at": None}))):
        r = client.get("/api/auth/verify?token=t")
    assert r.json()["verified"] is False


def test_logout_revokes_supabase_session():
    user = CurrentUser(id="user-1", email="demo@example.com", role="attendee", access_token="tok")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[main.get_current_user] = lambda: user
    fake = AsyncMock(return_value=(204, {}))
    try:
        with patch.object(main, "gotrue", fake):
            r = client.post("/api/auth/logout", headers={"Authorization": "Bearer tok"})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200
    assert fake.call_args.args[:2] == ("POST", "/logout")
    assert fake.call_args.kwargs["token"] == "tok"
