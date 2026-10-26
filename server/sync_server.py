#!/usr/bin/env python3
"""
SoundStats - servizio di sincronizzazione tra dispositivi.

Conserva una copia dei dati di ogni utente (lo stesso formato del backup
.soundstats, JSON compresso con gzip). L'utente si identifica con il token
di Spotify che l'app ha già: il servizio chiede a Spotify chi è (GET /me) e
gli dà accesso solo alla propria copia. Nessuna password, nessun account.

    GET    /api/sync/meta   -> {"exists", "updated", "size", "rows", "device"}
    GET    /api/sync        -> il file (application/gzip)
    PUT    /api/sync        -> salva il file (intestazioni X-Rows, X-Device)
    DELETE /api/sync        -> cancella la copia

Solo libreria standard. Ascolta su 127.0.0.1 (nginx fa da proxy).
"""
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get("SYNC_HOST", "127.0.0.1")
PORT = int(os.environ.get("SYNC_PORT", "8110"))
DATA = Path(os.environ.get("SYNC_DATA", Path(__file__).resolve().parent / "data"))
MAX_BYTES = int(os.environ.get("SYNC_MAX_MB", "80")) * 1024 * 1024
TOKEN_TTL = 15 * 60

_tokens = {}  # sha256(token) -> (spotify_id, scadenza)
_lock = threading.Lock()


def spotify_user(token):
    """Restituisce l'id Spotify del proprietario del token, o None."""
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.time()
    with _lock:
        hit = _tokens.get(key)
        if hit and hit[1] > now:
            return hit[0]
    req = urllib.request.Request("https://api.spotify.com/v1/me", headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            user_id = json.load(res).get("id")
    except (urllib.error.URLError, ValueError, TimeoutError):
        return None
    if not user_id:
        return None
    with _lock:
        if len(_tokens) > 1000:
            _tokens.clear()
        _tokens[key] = (user_id, now + TOKEN_TTL)
    return user_id


def user_dir(user_id):
    safe = user_id if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", user_id) else hashlib.sha256(user_id.encode()).hexdigest()
    return DATA / safe


class Handler(BaseHTTPRequestHandler):
    server_version = "SoundStatsSync/1"

    def log_message(self, fmt, *args):  # niente token o dati nei log
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def auth(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer ") or len(header) > 2000:
            self.send_json(401, {"error": "login richiesto"})
            return None
        user_id = spotify_user(header[7:].strip())
        if not user_id:
            self.send_json(401, {"error": "token Spotify non valido"})
            return None
        return user_dir(user_id)

    def read_meta(self, folder):
        try:
            return json.loads((folder / "meta.json").read_text())
        except (OSError, ValueError):
            return None

    def do_GET(self):
        if self.path not in ("/api/sync", "/api/sync/meta"):
            return self.send_json(404, {"error": "non trovato"})
        folder = self.auth()
        if not folder:
            return
        meta = self.read_meta(folder)
        if self.path == "/api/sync/meta":
            return self.send_json(200, {"exists": bool(meta), **(meta or {})})
        file = folder / "backup.gz"
        if not meta or not file.exists():
            return self.send_json(404, {"error": "nessuna copia salvata"})
        size = file.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/gzip")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with file.open("rb") as fh:
            while chunk := fh.read(1 << 16):
                self.wfile.write(chunk)

    def do_PUT(self):
        if self.path != "/api/sync":
            return self.send_json(404, {"error": "non trovato"})
        folder = self.auth()
        if not folder:
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            return self.send_json(413, {"error": "dimensione non valida"})
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / "backup.gz.tmp"
        remaining = length
        with tmp.open("wb") as fh:
            first = True
            while remaining:
                chunk = self.rfile.read(min(1 << 16, remaining))
                if not chunk:
                    break
                if first and chunk[:2] != b"\x1f\x8b":
                    fh.close()
                    tmp.unlink(missing_ok=True)
                    return self.send_json(400, {"error": "formato non valido"})
                first = False
                fh.write(chunk)
                remaining -= len(chunk)
        if remaining:
            tmp.unlink(missing_ok=True)
            return self.send_json(400, {"error": "caricamento incompleto"})
        os.replace(tmp, folder / "backup.gz")
        meta = {
            "updated": int(time.time() * 1000),
            "size": length,
            "rows": int(self.headers.get("X-Rows", "0") or 0),
            "device": (self.headers.get("X-Device", "") or "")[:64],
        }
        (folder / "meta.json").write_text(json.dumps(meta))
        self.send_json(200, {"exists": True, **meta})

    def do_DELETE(self):
        if self.path != "/api/sync":
            return self.send_json(404, {"error": "non trovato"})
        folder = self.auth()
        if not folder:
            return
        for name in ("backup.gz", "meta.json"):
            (folder / name).unlink(missing_ok=True)
        self.send_json(200, {"exists": False})


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    os.chmod(DATA, 0o700)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
