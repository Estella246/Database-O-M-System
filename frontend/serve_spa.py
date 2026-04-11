#!/usr/bin/env python3
"""
Dev static server with SPA fallback so refresh on /tickets/<id> or /admin/... works.

python -m http.server serves real files only — those URLs 404. Run instead:

  cd frontend && python3 serve_spa.py

API stays on port 8000; the page uses resolveApiBaseUrl() for /api calls.
"""
from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class SPAStaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        path_no_q = self.path.split("?", 1)[0]
        full = Path(self.translate_path(self.path))
        if not full.is_file():
            last = path_no_q.rstrip("/").split("/")[-1] if path_no_q.strip("/") else ""
            # Real assets (styles.css, app.js, …) keep normal 404 if missing
            if "." not in last:
                self.path = "/index.html"
        return super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        if os.environ.get("SPA_QUIET"):
            return
        super().log_message(fmt, *args)


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8080"))
    with ThreadingHTTPServer((host, port), SPAStaticHandler) as httpd:
        print(f"SPA static: http://{host}:{port}/  (dir={ROOT})")
        print("Backend API: start separately on :8000 (uvicorn …).")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
