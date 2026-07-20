#!/usr/bin/env python3
import json
import os
import socket
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


PORT = int(os.getenv("SUB_PORT", "18080"))
IFACE = os.getenv("SUB_IFACE", "eth0")
CONFIG_PATH = os.getenv("SUB_CONFIG_PATH", "/opt/vps-subscription/config.yaml")
TOTAL_BYTES = int(os.getenv("SUB_TOTAL_BYTES", str(3000 * 1000 * 1000 * 1000)))
EXPIRE_TS = int(os.getenv("SUB_EXPIRE_TS", "0"))
TOKEN = os.getenv("SUB_TOKEN", "")
UPDATE_INTERVAL = os.getenv("SUB_UPDATE_INTERVAL", "60")


def month_usage_bytes():
    try:
        raw = subprocess.check_output(
            ["vnstat", "--json", "m", "-i", IFACE],
            stderr=subprocess.DEVNULL,
            timeout=3,
            text=True,
        )
        data = json.loads(raw)
    except Exception:
        return 0, 0

    interfaces = data.get("interfaces", [])
    if not interfaces:
        return 0, 0

    months = interfaces[0].get("traffic", {}).get("month", [])
    if not months:
        return 0, 0

    current = months[-1]
    try:
        tx = int(current.get("tx", 0))
        rx = int(current.get("rx", 0))
    except (TypeError, ValueError):
        return 0, 0

    return tx, rx


def load_config():
    with open(CONFIG_PATH, "rb") as f:
        return f.read()


def token_allowed(query):
    if not TOKEN:
        return True

    values = parse_qs(query, keep_blank_values=True).get("token", [])
    return TOKEN in values


class Handler(BaseHTTPRequestHandler):
    server_version = "vps-subscription/1.0"

    def log_message(self, fmt, *args):
        return

    def send_text(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self.send_text(200, b"ok\n")
            return

        if parsed.path not in ("/sub", "/sub.yaml"):
            self.send_text(404, b"not found\n")
            return

        if not token_allowed(parsed.query):
            self.send_text(403, b"forbidden\n")
            return

        try:
            body = load_config()
        except FileNotFoundError:
            self.send_text(500, b"config file missing\n")
            return
        except OSError:
            self.send_text(500, b"config file unreadable\n")
            return

        upload, download = month_usage_bytes()
        userinfo = f"upload={upload}; download={download}; total={TOTAL_BYTES}"
        if EXPIRE_TS > 0:
            userinfo += f"; expire={EXPIRE_TS}"

        self.send_response(200)
        self.send_header("Content-Type", "text/yaml; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Subscription-Userinfo", userinfo)
        self.send_header("Profile-Update-Interval", UPDATE_INTERVAL)
        self.end_headers()
        self.wfile.write(body)


class DualStackSubscriptionServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def create_server():
    try:
        return DualStackSubscriptionServer(("::", PORT), Handler)
    except OSError as error:
        print(
            f"dual-stack bind unavailable ({error}); falling back to IPv4",
            flush=True,
        )
        return ThreadingHTTPServer(("0.0.0.0", PORT), Handler)


def main():
    httpd = create_server()
    print(
        f"serving on {httpd.server_address}, iface={IFACE}, config={CONFIG_PATH}",
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
