"""Bun source-provider acceptance over the real LSP wire and a local HTTP server."""
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from lsp_client import Client


def run():
    bodies = [b'[Event "Provider fixture"]\n\n1. e4 e5 *\n']
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(bodies[0])

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="chess-lsp-sources-") as folder:
            root = Path(folder)
            config = {"version": 1, "providers": [{"id": "fixture", "kind": "http",
                      "url": f"http://127.0.0.1:{server.server_port}/games/{{id}}"}]}
            (root / "chess.sources.json").write_text(json.dumps(config))
            text = 'module lesson; game sample from "chessdb://fixture/123"; story lesson { board start game sample after 0 { prompt "Move?" answer "e4"; } }'
            story = root / "story.chess-story"
            story.write_text(text)
            for session in range(2):
                client = Client(["bun", "src/adapters/lsp.ts", "--stdio"], Path(__file__).resolve().parent.parent)
                try:
                    client.request("initialize", {"processId": None, "rootUri": root.as_uri(), "capabilities": {},
                        "workspaceFolders": [{"uri": root.as_uri(), "name": "fixture"}]})
                    client.notify("initialized", {})
                    client.notify("textDocument/didOpen", {"textDocument": {"uri": story.as_uri(), "languageId": "chess-narrative", "version": 1, "text": text}})
                    assert client.diagnostics(story.as_uri(), 1) == [], f"Provider diagnostics in session {session}"
                    assert (root / "chess.sources.lock.json").exists(), "LSP did not publish source resolution"
                finally:
                    client.close()
                bodies[0] = b"1. e5 *"  # Invalid replacement must never replace locked content.
            assert requests == ["/games/123"], requests
            print("Bun LSP sources: remote acquisition and fresh-session lock reuse passed")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def configuration_health():
    for invalid in ["malformed", "changed"]:
        with tempfile.TemporaryDirectory(prefix="chess-lsp-config-") as folder:
            root = Path(folder)
            (root / "chess.sources.json").write_text("{bad" if invalid == "malformed" else json.dumps({"version": 1, "providers": []}))
            if invalid == "changed":
                (root / "chess.sources.lock.json").write_text(json.dumps({"version": 1, "config": "sha256:" + "0" * 64, "imports": {}}))
            text = "module lesson;"
            story = root / "story.chess-story"
            story.write_text(text)
            client = Client(["bun", "src/adapters/lsp.ts", "--stdio"], Path(__file__).resolve().parent.parent)
            try:
                client.request("initialize", {"processId": None, "rootUri": root.as_uri(), "capabilities": {}, "workspaceFolders": [{"uri": root.as_uri(), "name": "fixture"}]})
                client.notify("initialized", {})
                client.notify("textDocument/didOpen", {"textDocument": {"uri": story.as_uri(), "languageId": "chess-narrative", "version": 1, "text": text}})
                assert client.diagnostics(story.as_uri(), 1) == [], invalid
                client.notify("textDocument/didChange", {"textDocument": {"uri": story.as_uri(), "version": 2}, "contentChanges": [{"text": text + " @"}]})
                assert client.diagnostics(story.as_uri(), 2), invalid
            finally:
                client.close()
    print("Bun LSP sources: invalid configuration preserves editor health")


def alias_health():
    with tempfile.TemporaryDirectory(prefix="chess-lsp-alias-") as folder:
        root = Path(folder)
        (root / "archive").mkdir()
        (root / "archive" / "opera.pgn").write_text("1. e4 e5 *")
        (root / "chess.sources.json").write_text(json.dumps({"version": 1, "providers": [{"id": "archive", "kind": "directory", "path": "./archive/"}]}))
        text = 'module m; game explicit from "./opera.pgn"; game remote from "opera.pgn";'
        story = root / "story.chess-story"
        story.write_text(text)
        client = Client(["bun", "src/adapters/lsp.ts", "--stdio"], Path(__file__).resolve().parent.parent)
        try:
            client.request("initialize", {"processId": None, "rootUri": root.as_uri(), "capabilities": {}, "workspaceFolders": [{"uri": root.as_uri(), "name": "fixture"}]})
            client.notify("initialized", {})
            client.notify("textDocument/didOpen", {"textDocument": {"uri": story.as_uri(), "languageId": "chess-narrative", "version": 1, "text": text}})
            diagnostics = client.diagnostics(story.as_uri(), 1)
            assert any(d.get("code") == "source/missing-game" for d in diagnostics), diagnostics
            client.notify("textDocument/didChange", {"textDocument": {"uri": story.as_uri(), "version": 2}, "contentChanges": [{"text": 'module m; game remote from "opera.pgn";'}]})
            assert client.diagnostics(story.as_uri(), 2) == [], "Removed explicit reference still constrains resolution"
        finally:
            client.close()
    print("Bun LSP sources: explicit-file alias policy and edit recovery passed")


if __name__ == "__main__":
    run()
    configuration_health()
    alias_health()
