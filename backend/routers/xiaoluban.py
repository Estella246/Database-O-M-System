from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from utils.xiaoluban_message import send_message_async

router = APIRouter(prefix="/api/xiaoluban", tags=["xiaoluban"])


class SendMessageRequest(BaseModel):
    operator_id: str
    content: str
    receiver: str


class SendMessageResponse(BaseModel):
    success: bool
    message: str


@router.post("/send-message", response_model=SendMessageResponse)
async def api_send_message(req: SendMessageRequest) -> SendMessageResponse:
    result = await send_message_async(req.content, req.receiver)
    if result:
        return SendMessageResponse(success=True, message="消息发送成功")
    return SendMessageResponse(success=False, message="消息发送失败")