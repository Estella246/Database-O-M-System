from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def cleanup_ticket_export_tasks() -> None:
    """APScheduler：清理超时/过期的工作台导出任务与磁盘文件。

    - processing 超时 → error + 删除残留文件
    - ready 超过保留时长 → expired + 删除文件
    - error/expired 超过硬删除时长 → 物理删除行
    """
    from database import db_conn
    from config import (
        TICKET_EXPORT_RETENTION_HOURS,
        TICKET_EXPORT_HARD_DELETE_HOURS,
        TICKET_EXPORT_PROCESSING_TIMEOUT_SECONDS,
    )

    try:
        with db_conn() as conn:
            row = conn.execute(
                "SELECT to_regclass('public.ticket_export_task') AS name"
            ).fetchone()
            if not row or not row.get("name"):
                return

            timed_out = conn.execute(
                """
                UPDATE ticket_export_task
                SET status = 'error',
                    error_message = '导出超时',
                    updated_at = NOW()
                WHERE status = 'processing'
                  AND updated_at < NOW() - INTERVAL '1 second' * %s
                RETURNING id, file_path
                """,
                (TICKET_EXPORT_PROCESSING_TIMEOUT_SECONDS,),
            ).fetchall()

            expired_ready = conn.execute(
                """
                UPDATE ticket_export_task
                SET status = 'expired',
                    updated_at = NOW()
                WHERE status = 'ready'
                  AND updated_at < NOW() - INTERVAL '1 hour' * %s
                RETURNING id, file_path
                """,
                (TICKET_EXPORT_RETENTION_HOURS,),
            ).fetchall()

            paths_to_remove = []
            for r in list(timed_out) + list(expired_ready):
                path = str(r.get("file_path") or "")
                if path:
                    paths_to_remove.append(path)
                conn.execute(
                    "UPDATE ticket_export_task SET file_path = '' WHERE id = %s",
                    (int(r["id"]),),
                )

            hard_deleted = conn.execute(
                """
                DELETE FROM ticket_export_task
                WHERE status IN ('expired', 'error', 'cancelled')
                  AND updated_at < NOW() - INTERVAL '1 hour' * %s
                RETURNING id, file_path
                """,
                (TICKET_EXPORT_HARD_DELETE_HOURS,),
            ).fetchall()
            for r in hard_deleted:
                path = str(r.get("file_path") or "")
                if path:
                    paths_to_remove.append(path)

            # 清理已完成任务残留的侧表单号（正常路径生成后已删；兜底）
            conn.execute(
                """
                DELETE FROM ticket_export_task_no n
                USING ticket_export_task t
                WHERE n.task_id = t.id
                  AND t.status IN ('ready', 'expired', 'error', 'cancelled')
                """
            )

            conn.commit()

        removed = 0
        for path in paths_to_remove:
            try:
                if path and os.path.isfile(path):
                    os.unlink(path)
                    removed += 1
            except OSError:
                pass

        logger.info(
            "[audit] ticket_export cleanup: timed_out=%d expired_ready=%d hard_deleted=%d files_removed=%d",
            len(timed_out),
            len(expired_ready),
            len(hard_deleted),
            removed,
        )
    except Exception as e:  # noqa: BLE001
        logger.error("ticket export cleanup failed: %s", e, exc_info=True)
