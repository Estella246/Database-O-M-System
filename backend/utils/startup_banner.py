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
    """打印启动横幅到 stdout；可选再写一条 INFO 便于文件日志检索。"""
    text = startup_banner_text()
    print(text, file=sys.stdout, flush=True)
    if logger is not None:
        logger.info("Database-O-M-System startup complete")
