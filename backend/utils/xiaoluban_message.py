from __future__ import annotations

import logging

import requests

from config import XIAOLUBAN_MESSAGE_URL, XIAOLUBAN_MESSAGE_SEND_TOKEN

logger = logging.getLogger(__name__)


def send_message(content: str, receiver: str) -> bool:
    payload = {
        "content": content,
        "receiver": receiver,
        "auth": XIAOLUBAN_MESSAGE_SEND_TOKEN,
    }
    headers = {"Content-Type": "application/json"}
    try:
        res = requests.post(XIAOLUBAN_MESSAGE_URL, json=payload, headers=headers)
        if res.status_code == 200:
            try:
                if res.json().get("status") == "ok":
                    return True
            except ValueError:
                pass
        return False
    except Exception as e:
        logger.warning(f"xiaoluban message unexpected error: {e}")
        return False