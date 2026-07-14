"""服务启动/重启时打印的酷炫横幅。"""
from __future__ import annotations

import logging
import sys

STARTUP_BANNER = """
   ================================================================
        ##########################################################
        #                                                        #
        #           DATABASE · O · M · SYSTEM                    #
        #                                                        #
        ##########################################################
                 运维工单平台 · 服务已就绪
   ================================================================
""".rstrip(
    "\n"
)


def startup_banner_text() -> str:
    return STARTUP_BANNER


def emit_startup_banner(logger: logging.Logger | None = None) -> None:
    """通过 logging 输出启动横幅（stdout / LOG_DIR 文件都会收到）。

    生产环境通常只看 LOG_DIR 轮转文件；若仅 print 到 stdout，文件日志里看不到横幅。
    """
    text = startup_banner_text()
    if logger is None:
        print(text, file=sys.stdout, flush=True)
        return
    # 整段一次写入，避免每行重复 asctime/level/name 前缀把图案拆碎
    logger.info("\n%s", text)
    logger.info("Database-O-M-System startup complete")
