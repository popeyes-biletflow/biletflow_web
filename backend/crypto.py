import os
import hmac
import hashlib
import time
from typing import Tuple, Dict
from dotenv import load_dotenv


load_dotenv()

# Retrieve the secret key for HMAC signing from environment variables
QR_SECRET = os.getenv("QR_SECRET")

if not QR_SECRET:
    raise EnvironmentError("QR_SECRET environment variable is not set.")


def generate_hmac_signature(ticket_id: str, event_id: str, user_id: str, expires_at: int) -> str:
    """Generate HMAC-SHA256 hex digest for the given ticket data.

    The canonical message format is ``{ticket_id}:{event_id}:{user_id}:{expires_at}``.
    ``expires_at`` must be an integer Unix timestamp.
    """
    message = f"{ticket_id}:{event_id}:{user_id}:{expires_at}"
    return hmac.new(QR_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()


def verify_hmac_signature(qr_payload: str) -> Tuple[bool, str, Dict[str, str]]:
    """Verify a QR payload and return validation result.

    The payload must be in the format ``ticket_id:event_id:user_id:expires_at:signature``.
    Returns a tuple ``(is_valid, error_reason, parsed_data)`` where ``parsed_data``
    contains the extracted fields when verification succeeds.
    """
    parts = qr_payload.split(":")
    if len(parts) != 5:
        return False, "Invalid QR payload format.", {}
    ticket_id, event_id, user_id, expires_at_str, received_sig = parts
    try:
        expires_at = int(expires_at_str)
    except ValueError:
        return False, "Expiration timestamp is not an integer.", {}

    # Check expiration
    current_ts = int(time.time())
    if current_ts > expires_at:
        return False, "QR code has expired.", {}

    # Recompute expected signature
    expected_sig = generate_hmac_signature(ticket_id, event_id, user_id, expires_at)
    if not hmac.compare_digest(expected_sig, received_sig):
        return False, "Signature mismatch – QR payload may be tampered.", {}

    return True, "", {"ticket_id": ticket_id, "event_id": event_id, "user_id": user_id, "expires_at": expires_at}
