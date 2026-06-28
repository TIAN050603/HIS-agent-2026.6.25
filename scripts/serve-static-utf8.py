#!/usr/bin/env python3
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Utf8StaticHandler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        content_type = super().guess_type(path)
        if content_type in {
            "text/html",
            "text/css",
            "text/javascript",
            "application/javascript",
            "application/json",
            "text/markdown",
        }:
            return content_type + "; charset=utf-8"
        return content_type

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="Serve static files with UTF-8 text response headers.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=5500, type=int)
    parser.add_argument("--directory", default=".")
    args = parser.parse_args()

    handler = partial(Utf8StaticHandler, directory=args.directory)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {args.directory} on {args.host}:{args.port} with UTF-8 text headers", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
