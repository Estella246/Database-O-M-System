from __future__ import annotations

import http.server
import os
import posixpath
import socketserver
from urllib.parse import unquote


class SPARouteHandler(http.server.SimpleHTTPRequestHandler):
    """
    A tiny dev server that:
    - serves static files from ./frontend
    - falls back to index.html for unknown routes like /tickets/YW20260402078
    """

    def translate_path(self, path: str) -> str:
        path = path.split("?", 1)[0].split("#", 1)[0]
        path = posixpath.normpath(unquote(path))
        words = [w for w in path.split("/") if w]
        full = os.getcwd()
        for w in words:
            if os.path.dirname(w) or w in (os.curdir, os.pardir):
                continue
            full = os.path.join(full, w)
        return full

    def do_GET(self) -> None:
        p = self.path.split("?", 1)[0]
        file_path = self.translate_path(p)

        # If request is for a real file, serve it
        if os.path.isfile(file_path):
            return super().do_GET()

        # Otherwise, SPA fallback
        self.path = "/index.html"
        return super().do_GET()


def main() -> None:
    base_port = int(os.environ.get("PORT", "5173"))
    os.chdir(os.path.join(os.path.dirname(__file__)))

    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

    last_err: OSError | None = None
    for offset in range(0, 20):
        port = base_port + offset
        try:
            with ReusableTCPServer(("127.0.0.1", port), SPARouteHandler) as httpd:
                print(f"Dev server: http://127.0.0.1:{port}", flush=True)
                httpd.serve_forever()
        except OSError as e:
            last_err = e
            continue

    raise RuntimeError(
        f"Could not bind to ports {base_port}..{base_port+19} (last error: {last_err})"
    )


if __name__ == "__main__":
    main()

