from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def cleanup_ai_export_tasks() -> None:
    """APScheduler periodic cleanup for expired/timeout AI Export tasks.

    Rules:
    - draft/preview older than AI_EXPORT_DRAFT_TIMEOUT_SECONDS -> expired + delete row data
    - ready older than AI_EXPORT_RETENTION_DAYS -> expired + delete row data + clear report_html
    - processing older than AI_EXPORT_PROCESSING_TIMEOUT_SECONDS -> error
    - expired older than AI_EXPORT_HARD_DELETE_DAYS -> physical delete
    """
    from database import db_conn
    from config import (
        AI_EXPORT_DRAFT_TIMEOUT_SECONDS,
        AI_EXPORT_RETENTION_DAYS,
        AI_EXPORT_PROCESSING_TIMEOUT_SECONDS,
        AI_EXPORT_HARD_DELETE_DAYS,
    )

    try:
        with db_conn() as conn:
            # 1. draft/preview timeout -> expired + delete row data
            conn.execute(
                """
                UPDATE ai_export_task SET status = 'expired', updated_at = NOW()
                WHERE status IN ('draft', 'preview')
                  AND created_at < NOW() - INTERVAL '1 second' * %s
                """,
                (AI_EXPORT_DRAFT_TIMEOUT_SECONDS,),
            )
            expired_ids = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM ai_export_task WHERE status = 'expired'"
                ).fetchall()
            ]
            if expired_ids:
                conn.execute(
                    "DELETE FROM ai_export_row WHERE task_id = ANY(%s)",
                    (expired_ids,),
                )

            # 2. ready timeout -> expired + delete row data + clear report_html
            conn.execute(
                """
                UPDATE ai_export_task
                SET status = 'expired',
                    report_html = '',
                    updated_at = NOW()
                WHERE status = 'ready'
                  AND updated_at < NOW() - INTERVAL '1 day' * %s
                """,
                (AI_EXPORT_RETENTION_DAYS,),
            )
            # Also delete row data for these newly-expired ready tasks
            ready_expired_ids = [
                r["id"]
                for r in conn.execute(
                    """
                    SELECT id FROM ai_export_task
                    WHERE status = 'expired' AND id NOT IN (%s)
                    """,
                    (expired_ids,) if expired_ids else (0,),
                ).fetchall()
            ]
            if ready_expired_ids:
                conn.execute(
                    "DELETE FROM ai_export_row WHERE task_id = ANY(%s)",
                    (ready_expired_ids,),
                )

            # 3. processing timeout -> error
            conn.execute(
                """
                UPDATE ai_export_task
                SET status = 'error',
                    error_message = '处理超时',
                    updated_at = NOW()
                WHERE status = 'processing'
                  AND updated_at < NOW() - INTERVAL '1 second' * %s
                """,
                (AI_EXPORT_PROCESSING_TIMEOUT_SECONDS,),
            )

            # 4. expired hard delete -> physical delete
            conn.execute(
                """
                DELETE FROM ai_export_task
                WHERE status = 'expired'
                  AND updated_at < NOW() - INTERVAL '1 day' * %s
                """,
                (AI_EXPORT_HARD_DELETE_DAYS,),
            )

            conn.commit()

        logger.info(
            "[audit] ai_export cleanup: expired=%d, ready_expired=%d",
            len(expired_ids),
            len(ready_expired_ids),
        )

    except Exception as e:
        logger.error("AI Export cleanup failed: %s", e, exc_info=True)