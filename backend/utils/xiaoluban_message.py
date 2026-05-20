from __future__ import annotations

import logging

import httpx

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
        with httpx.Client(timeout=10.0) as client:
            response = client.post(XIAOLUBAN_MESSAGE_URL, json=payload, headers=headers)
            if response.status_code != 200:
                logger.warning(f"xiaoluban message failed: status={response.status_code}")
                return False
            body = response.text
            if body == "null" or not body:
                return False
            return True
    except httpx.HTTPError as e:
        logger.warning(f"xiaoluban message http error: {e}")
        return False
    except Exception as e:
        logger.warning(f"xiaoluban message unexpected error: {e}")
        return False


async def send_message_async(content: str, receiver: str) -> bool:
    payload = {
        "content": content,
        "receiver": receiver,
        "auth": XIAOLUBAN_MESSAGE_SEND_TOKEN,
    }
    headers = {"Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(XIAOLUBAN_MESSAGE_URL, json=payload, headers=headers)
            if response.status_code != 200:
                logger.warning(f"xiaoluban message failed: status={response.status_code}")
                return False
            body = response.text
            if body == "null" or not body:
                return False
            return True
    except httpx.HTTPError as e:
        logger.warning(f"xiaoluban message http error: {e}")
        return False
    except Exception as e:
        logger.warning(f"xiaoluban message unexpected error: {e}")
        return False