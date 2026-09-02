"""工作台工单异步导出：创建任务 → APScheduler 生成文件 → 轮询完成后下载。"""
from __future__ import annotations

import json
import logging
import os
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import psycopg
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from psycopg.errors import UndefinedTable
from starlette.background import BackgroundTask

from config import (
    TICKET_EXPORT_DIR,
    TICKET_EXPORT_MAX_CONCURRENT_TASKS,
    TICKET_EXPORT_NO_INSERT_BATCH,
    _TICKET_EXPORT_SCHEMA_HINT,
)
from database import db_conn
from ticket_export import (
    _file_chunk_iterator,
    _remove_temp_file,
    _resolve_ticket_nos,
    restrict_ticket_nos_to_template,
    payload_export_template_code,
    build_export_columns,
    write_export_file_to_path,
)
from ticket_export_fields import MAX_EXPORT_TICKETS

logger = logging.getLogger(__name__)

# 进程内取消标记（与 AI Export 相同模式）；worker 每批检查
_cancelled_tasks: set[int] = set()


class TicketExportCancelled(Exception):
    """用户取消导出。"""


def _check_table_ready(conn: psycopg.Connection) -> None:
    try:
        row = conn.execute(
            "SELECT to_regclass('public.ticket_export_task') AS name"
        ).fetchone()
        row_no = conn.execute(
            "SELECT to_regclass('public.ticket_export_task_no') AS name"
        ).fetchone()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=_TICKET_EXPORT_SCHEMA_HINT) from exc
    if not row or not row.get("name") or not row_no or not row_no.get("name"):
        raise HTTPException(status_code=503, detail=_TICKET_EXPORT_SCHEMA_HINT)


def ensure_export_dir() -> Path:
    path = Path(TICKET_EXPORT_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _insert_task_ticket_nos(
    conn: psycopg.Connection, task_id: int, ticket_nos: list[str]
) -> None:
    """分批写入侧表，避免单次超大 INSERT / JSONB。"""
    batch = max(100, int(TICKET_EXPORT_NO_INSERT_BATCH))
    with conn.cursor() as cur:
        for i in range(0, len(ticket_nos), batch):
            chunk = ticket_nos[i : i + batch]
            rows = [(task_id, i + j, no) for j, no in enumerate(chunk)]
            # psycopg3：executemany 在 cursor 上，Connection 无此方法
            cur.executemany(
                "INSERT INTO ticket_export_task_no (task_id, seq, ticket_no) VALUES (%s, %s, %s)",
                rows,
            )


def _load_task_ticket_nos(conn: psycopg.Connection, task_id: int) -> list[str]:
    rows = conn.execute(
        """
        SELECT ticket_no FROM ticket_export_task_no
        WHERE task_id = %s
        ORDER BY seq
        """,
        (task_id,),
    ).fetchall()
    return [str(r["ticket_no"]) for r in rows if r.get("ticket_no")]


def _delete_task_ticket_nos(conn: psycopg.Connection, task_id: int) -> None:
    conn.execute("DELETE FROM ticket_export_task_no WHERE task_id = %s", (task_id,))


def export_task_template_code(conn: psycopg.Connection, task_id: int) -> str:
    """任务 payload 中的 template_code；任务不存在或未记录时为空（回落工作台导出权限）。"""
    try:
        row = conn.execute(
            "SELECT payload_json FROM ticket_export_task WHERE id = %s",
            (task_id,),
        ).fetchone()
    except UndefinedTable:
        conn.rollback()
        return ""
    if not row:
        return ""
    payload = row.get("payload_json") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    if not isinstance(payload, dict):
        return ""
    return str(payload.get("template_code") or "").strip()


def create_ticket_export_task(
    payload: dict[str, Any],
    *,
    get_whitelist_flags_fn: Callable[..., dict[str, bool]],
    check_export_permission_fn: Callable[[psycopg.Connection, str], None],
) -> dict[str, Any]:
    operator_id = str(payload.get("operator_id") or "demo_001").strip()
    export_format = str(payload.get("format") or "csv").strip().lower()
    if export_format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format 须为 xlsx 或 csv")

    export_range = str(payload.get("range") or "selected").strip().lower()
    if export_range not in ("selected", "all"):
        raise HTTPException(status_code=400, detail="range 须为 selected 或 all")

    selected_fields = payload.get("selected_fields") or {}
    if not isinstance(selected_fields, dict):
        raise HTTPException(status_code=400, detail="selected_fields 须为对象")
    template_code = payload_export_template_code(payload)
    columns = build_export_columns(selected_fields, template_code=template_code)
    if not columns:
        raise HTTPException(status_code=400, detail="请至少选择一个导出字段")

    with db_conn() as conn:
        _check_table_ready(conn)
        check_export_permission_fn(conn, operator_id)

        processing_count = int(
            conn.execute(
                "SELECT COUNT(*) AS cnt FROM ticket_export_task WHERE status = 'processing'"
            ).fetchone()["cnt"]
        )
        if processing_count >= TICKET_EXPORT_MAX_CONCURRENT_TASKS:
            raise HTTPException(
                status_code=429,
                detail=f"当前有 {processing_count} 个导出任务正在生成，请稍后再试",
            )

        try:
            ticket_nos = _resolve_ticket_nos(
                payload, get_whitelist_flags_fn=get_whitelist_flags_fn
            )
            ticket_nos = restrict_ticket_nos_to_template(
                conn, ticket_nos, payload_export_template_code(payload)
            )
        except HTTPException:
            raise
        except UndefinedTable as exc:
            raise HTTPException(status_code=503, detail="工单列表快照不可用") from exc

        if len(ticket_nos) > MAX_EXPORT_TICKETS:
            raise HTTPException(
                status_code=400,
                detail=f"导出条数超过上限 {MAX_EXPORT_TICKETS}，请缩小筛选范围",
            )
        if not ticket_nos:
            raise HTTPException(status_code=400, detail="无可导出的工单数据")

        today = datetime.now().strftime("%Y-%m-%d")
        filename_prefix = (
            str(payload.get("filename_prefix") or "").strip() or f"{operator_id}_{today}"
        )
        extension = "csv" if export_format == "csv" else "xlsx"
        filename = f"{filename_prefix}.{extension}"
        total_rows = len(ticket_nos)

        # payload 只存筛选条件与字段配置，不存数万条单号
        stored_payload = {
            "operator_id": operator_id,
            "operator_name": str(payload.get("operator_name") or ""),
            "format": export_format,
            "range": export_range,
            "selected_fields": selected_fields,
            "filename_prefix": filename_prefix,
            "list_query": payload.get("list_query") if export_range == "all" else {},
            "template_code": template_code,
        }

        row = conn.execute(
            """
            INSERT INTO ticket_export_task
              (creator_id, status, export_format, export_range, payload_json,
               filename, total_rows, processed_rows, updated_at)
            VALUES
              (%s, 'pending', %s, %s, %s::jsonb, %s, %s, 0, NOW())
            RETURNING id
            """,
            (
                operator_id,
                export_format,
                export_range,
                json.dumps(stored_payload, ensure_ascii=False),
                filename,
                total_rows,
            ),
        ).fetchone()
        task_id = int(row["id"])
        _insert_task_ticket_nos(conn, task_id, ticket_nos)
        conn.commit()

    # 尽早丢掉 Python 侧大列表引用（GC 友好）
    del ticket_nos

    scheduled = False
    try:
        from app import _scheduler

        if getattr(_scheduler, "running", False):
            _scheduler.add_job(
                run_ticket_export_task,
                "date",
                args=[task_id],
                id=f"ticket_export_{task_id}",
                replace_existing=True,
            )
            scheduled = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("scheduler unavailable for ticket export: %s", exc)

    if not scheduled:
        run_ticket_export_task(task_id)

    return {
        "task_id": task_id,
        "status": "pending",
        "total_rows": total_rows,
        "filename": filename,
    }


def _update_progress(task_id: int, processed_rows: int) -> None:
    if task_id in _cancelled_tasks:
        raise TicketExportCancelled("用户取消导出")
    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT status FROM ticket_export_task WHERE id = %s",
                (task_id,),
            ).fetchone()
            if row and str(row.get("status") or "") == "cancelled":
                _cancelled_tasks.add(task_id)
                raise TicketExportCancelled("用户取消导出")
            conn.execute(
                """
                UPDATE ticket_export_task
                SET processed_rows = %s, updated_at = NOW()
                WHERE id = %s AND status = 'processing'
                """,
                (processed_rows, task_id),
            )
            conn.commit()
    except TicketExportCancelled:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("ticket export progress update failed task_id=%s: %s", task_id, exc)


def _purge_task_files(task_id: int, file_path: str = "") -> None:
    paths = set()
    if file_path:
        paths.add(file_path)
    export_dir = ensure_export_dir()
    for ext in ("xlsx", "csv"):
        paths.add(str(export_dir / f"{task_id}.{ext}"))
    for path in paths:
        _remove_temp_file(path)


def _finalize_cancelled_task(task_id: int, file_path: str = "") -> None:
    _purge_task_files(task_id, file_path)
    try:
        with db_conn() as conn:
            _delete_task_ticket_nos(conn, task_id)
            conn.execute(
                """
                UPDATE ticket_export_task
                SET status = 'cancelled',
                    error_message = '用户取消',
                    file_path = '',
                    file_size = 0,
                    updated_at = NOW()
                WHERE id = %s AND status IN ('pending', 'processing', 'ready', 'cancelled')
                """,
                (task_id,),
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("finalize cancelled task failed task_id=%s: %s", task_id, exc)
    _cancelled_tasks.discard(task_id)


def cancel_ticket_export_task(task_id: int, operator_id: str) -> dict[str, Any]:
    """立刻取消任务：标记 cancelled、停 worker、删临时文件与侧表。"""
    op = str(operator_id or "").strip() or "demo_001"
    _cancelled_tasks.add(task_id)
    file_path = ""
    with db_conn() as conn:
        _check_table_ready(conn)
        task = conn.execute(
            """
            SELECT id, status, creator_id, file_path
            FROM ticket_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()
        if not task:
            _cancelled_tasks.discard(task_id)
            raise HTTPException(status_code=404, detail="导出任务不存在")
        if str(task["creator_id"]) != op:
            _cancelled_tasks.discard(task_id)
            raise HTTPException(status_code=403, detail="仅创建者可取消导出")
        file_path = str(task.get("file_path") or "")
        _delete_task_ticket_nos(conn, task_id)
        conn.execute(
            """
            UPDATE ticket_export_task
            SET status = 'cancelled',
                error_message = '用户取消',
                file_path = '',
                file_size = 0,
                updated_at = NOW()
            WHERE id = %s
            """,
            (task_id,),
        )
        conn.commit()

    _purge_task_files(task_id, file_path)
    logger.info("[audit] ticket_export cancelled task_id=%s by %s", task_id, op)
    return {"task_id": task_id, "status": "cancelled", "cancelled": True}


def run_ticket_export_task(
    task_id: int,
    *,
    normalize_person_fn: Callable[[str, str], str] | None = None,
) -> None:
    """APScheduler 后台线程：生成导出文件并更新任务状态。"""
    if normalize_person_fn is None:
        from routers.tickets import _normalize_person_field_value

        normalize_person_fn = _normalize_person_field_value

    file_path = ""
    ticket_nos: list[str] = []
    try:
        if task_id in _cancelled_tasks:
            _finalize_cancelled_task(task_id)
            return

        with db_conn() as conn:
            _check_table_ready(conn)
            task = conn.execute(
                """
                SELECT id, status, creator_id, export_format, payload_json, filename, total_rows
                FROM ticket_export_task WHERE id = %s
                """,
                (task_id,),
            ).fetchone()
            if not task:
                return
            if str(task["status"]) == "cancelled":
                _finalize_cancelled_task(task_id)
                return
            if str(task["status"]) not in ("pending", "processing"):
                return

            conn.execute(
                """
                UPDATE ticket_export_task
                SET status = 'processing', processed_rows = 0, error_message = '', updated_at = NOW()
                WHERE id = %s AND status IN ('pending', 'processing')
                """,
                (task_id,),
            )
            conn.commit()

            # 更新后再次确认未被取消
            again = conn.execute(
                "SELECT status FROM ticket_export_task WHERE id = %s",
                (task_id,),
            ).fetchone()
            if not again or str(again.get("status") or "") == "cancelled":
                _finalize_cancelled_task(task_id)
                return

            payload = task["payload_json"] or {}
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                payload = {}

            ticket_nos = _load_task_ticket_nos(conn, task_id)
            if not ticket_nos:
                raise ValueError("任务缺少工单编号列表")

            selected_fields = payload.get("selected_fields") or {}
            columns = build_export_columns(
                selected_fields if isinstance(selected_fields, dict) else {},
                template_code=payload_export_template_code(payload),
            )
            if not columns:
                raise ValueError("请至少选择一个导出字段")

            headers = [c["fullLabel"] for c in columns]
            export_node_keys = list(
                dict.fromkeys(c["nodeKey"] for c in columns if c.get("nodeKey"))
            )
            export_format = str(task["export_format"] or "csv")

        export_dir = ensure_export_dir()
        ext = "csv" if export_format == "csv" else "xlsx"
        file_path = str(export_dir / f"{task_id}.{ext}")

        def on_progress(processed: int) -> None:
            _update_progress(task_id, processed)

        write_export_file_to_path(
            file_path,
            export_format,
            headers,
            ticket_nos,
            columns,
            normalize_person_fn=normalize_person_fn,
            export_node_keys=export_node_keys,
            on_progress=on_progress,
            template_code=payload_export_template_code(payload),
        )
        row_count = len(ticket_nos)
        del ticket_nos

        if task_id in _cancelled_tasks:
            raise TicketExportCancelled("用户取消导出")

        file_size = os.path.getsize(file_path) if os.path.isfile(file_path) else 0
        with db_conn() as conn:
            # 若取消竞态：不再标 ready
            cur = conn.execute(
                "SELECT status FROM ticket_export_task WHERE id = %s",
                (task_id,),
            ).fetchone()
            if not cur or str(cur.get("status") or "") == "cancelled":
                raise TicketExportCancelled("用户取消导出")

            _delete_task_ticket_nos(conn, task_id)
            conn.execute(
                """
                UPDATE ticket_export_task
                SET status = 'ready',
                    file_path = %s,
                    file_size = %s,
                    processed_rows = total_rows,
                    updated_at = NOW()
                WHERE id = %s AND status = 'processing'
                """,
                (file_path, file_size, task_id),
            )
            conn.commit()
        logger.info(
            "[audit] ticket_export ready task_id=%s rows=%s size=%s",
            task_id,
            row_count,
            file_size,
        )
    except TicketExportCancelled:
        logger.info("[audit] ticket_export stopped by cancel task_id=%s", task_id)
        _finalize_cancelled_task(task_id, file_path)
    except Exception as exc:  # noqa: BLE001
        logger.exception("ticket export failed task_id=%s", task_id)
        if file_path:
            _remove_temp_file(file_path)
        try:
            with db_conn() as conn:
                _delete_task_ticket_nos(conn, task_id)
                conn.execute(
                    """
                    UPDATE ticket_export_task
                    SET status = 'error',
                        error_message = %s,
                        file_path = '',
                        updated_at = NOW()
                    WHERE id = %s AND status <> 'cancelled'
                    """,
                    (str(exc)[:500], task_id),
                )
                conn.commit()
        except Exception:  # noqa: BLE001
            logger.exception("failed to mark ticket export error task_id=%s", task_id)
        _cancelled_tasks.discard(task_id)


def get_ticket_export_progress(task_id: int, operator_id: str) -> dict[str, Any]:
    op = str(operator_id or "").strip() or "demo_001"
    with db_conn() as conn:
        _check_table_ready(conn)
        task = conn.execute(
            """
            SELECT id, status, creator_id, total_rows, processed_rows, error_message, filename
            FROM ticket_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="导出任务不存在")
        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可查看导出进度")
    return {
        "task_id": int(task["id"]),
        "status": str(task["status"]),
        "total_rows": int(task["total_rows"] or 0),
        "processed_rows": int(task["processed_rows"] or 0),
        "error_message": str(task["error_message"] or ""),
        "filename": str(task["filename"] or ""),
    }


def _cleanup_after_download(task_id: int, file_path: str) -> None:
    """下载流结束后立即删文件并清空侧表，不落盘保留。"""
    _remove_temp_file(file_path)
    try:
        with db_conn() as conn:
            _delete_task_ticket_nos(conn, task_id)
            conn.execute(
                """
                UPDATE ticket_export_task
                SET status = 'expired',
                    file_path = '',
                    file_size = 0,
                    downloaded_at = COALESCE(downloaded_at, NOW()),
                    updated_at = NOW()
                WHERE id = %s
                """,
                (task_id,),
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ticket export post-download cleanup failed task_id=%s: %s", task_id, exc)


def download_ticket_export_file(task_id: int, operator_id: str) -> StreamingResponse:
    op = str(operator_id or "").strip() or "demo_001"
    with db_conn() as conn:
        _check_table_ready(conn)
        task = conn.execute(
            """
            SELECT id, status, creator_id, file_path, filename, export_format
            FROM ticket_export_task WHERE id = %s
            """,
            (task_id,),
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="导出任务不存在")
        if str(task["creator_id"]) != op:
            raise HTTPException(status_code=403, detail="仅创建者可下载")
        if str(task["status"]) != "ready":
            raise HTTPException(
                status_code=409, detail=f"文件尚未就绪，当前状态: {task['status']}"
            )
        file_path = str(task["file_path"] or "")
        filename = str(task["filename"] or f"export_{task_id}.xlsx")
        export_format = str(task["export_format"] or "csv")
        if not file_path or not os.path.isfile(file_path):
            raise HTTPException(
                status_code=410, detail="导出文件已过期或不存在，请重新导出"
            )
        conn.execute(
            """
            UPDATE ticket_export_task
            SET downloaded_at = NOW(), updated_at = NOW()
            WHERE id = %s
            """,
            (task_id,),
        )
        conn.commit()

    encoded_filename = urllib.parse.quote(filename, safe="")
    disposition = (
        f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded_filename}'
    )
    media_type = (
        "text/csv;charset=utf-8"
        if export_format == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return StreamingResponse(
        _file_chunk_iterator(file_path),
        media_type=media_type,
        headers={"Content-Disposition": disposition},
        background=BackgroundTask(_cleanup_after_download, task_id, file_path),
    )
