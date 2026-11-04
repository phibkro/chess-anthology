"""Markdown authoring acceptance over the maintained LSP transport."""
import tempfile
from pathlib import Path
from lsp_client import Client


def run():
    compiler = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="chess-lsp-markdown-") as folder:
        root = Path(folder)
        (root / "opera.pgn").write_bytes((compiler / "examples/opera.pgn").read_bytes())
        (root / "chess.sources.jsonc").write_text('{"version":1, /* local only */ "providers":[]}')
        text = "---\nid: lesson\ngames:\n  opera: ./opera.pgn\n---\n\n# Story\n## Finish\n@board opera after 30\n@prompt Find the forcing move.\n@answer Qb8+\n"
        story = root / "lesson.chess.md"
        story.write_text(text)
        client = Client(["bun", "src/adapters/lsp.ts", "--stdio"], compiler)
        try:
            client.request("initialize", {"processId": None, "rootUri": root.as_uri(), "capabilities": {},
                "workspaceFolders": [{"uri": root.as_uri(), "name": "fixture"}]})
            client.notify("initialized", {})
            client.notify("textDocument/didOpen", {"textDocument": {"uri": story.as_uri(), "languageId": "markdown", "version": 1, "text": text}})
            assert client.diagnostics(story.as_uri(), 1) == [], "Markdown acquisition/linking failed"
            completion = client.request("textDocument/completion", {"textDocument": {"uri": story.as_uri()}, "position": {"line": 10, "character": 9}})
            queen = next(item for item in completion["items"] if item["label"] == "Qb8+")
            assert queen["textEdit"]["range"] == {"start": {"line": 10, "character": 8}, "end": {"line": 10, "character": 12}}, queen
            invalid = text.replace("@answer Qb8+", "@answer Ke9")
            client.notify("textDocument/didChange", {"textDocument": {"uri": story.as_uri(), "version": 2}, "contentChanges": [{"text": invalid}]})
            diagnostics = client.diagnostics(story.as_uri(), 2)
            illegal = next(item for item in diagnostics if item.get("code") == "chess/illegal-answer")
            assert illegal["range"]["start"]["line"] == 9, illegal
            client.notify("textDocument/didChange", {"textDocument": {"uri": story.as_uri(), "version": 3}, "contentChanges": [{"text": text}]})
            assert client.diagnostics(story.as_uri(), 3) == [], "Markdown edit recovery failed"
        finally:
            client.close()
    print("Bun LSP Markdown: acquisition, completion ranges, chess diagnostics and edit recovery passed")


def composition():
    compiler = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="chess-lsp-composition-") as folder:
        parent = Path(folder)
        root = parent / "project"
        external = parent / "external"
        root.mkdir()
        external.mkdir()
        (external / "opera.pgn").write_bytes((compiler / "examples/opera.pgn").read_bytes())
        definition = "---\nid: opera-module\ngames:\n  score: ./opera.pgn\nexports: [opera]\n---\n\n# Opera\n@id opera\n## Finish\n@board score after 30\n"
        story_source = external / "opera.chess.md"
        story_source.write_text(definition)
        text = "---\nid: collection-module\nuses:\n  opera: ../external/opera.chess.md#opera\ncollections:\n  nets: [opera]\nexports: [nets]\n---\n"
        document = root / "collection.chess.md"
        document.write_text(text)
        client = Client(["bun", "src/adapters/lsp.ts", "--stdio"], compiler)
        try:
            client.request("initialize", {"processId": None, "rootUri": root.as_uri(), "capabilities": {},
                "workspaceFolders": [{"uri": root.as_uri(), "name": "fixture"}]})
            client.notify("initialized", {})
            client.notify("textDocument/didOpen", {"textDocument": {"uri": document.as_uri(), "languageId": "markdown", "version": 1, "text": text}})
            assert client.diagnostics(document.as_uri(), 1) == [], "Composition outside workspace was not acquired and indexed"
            story_source.write_text(definition.replace("exports: [opera]", "exports: []"))
            client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": story_source.as_uri(), "type": 2}]})
            invalid = client.diagnostics(document.as_uri(), 1, lambda items: any(item.get("code") == "link/not-exported" for item in items))
            assert invalid, "Dependent collection did not invalidate"
            story_source.write_text(definition)
            client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": story_source.as_uri(), "type": 2}]})
            assert client.diagnostics(document.as_uri(), 1, lambda items: not items) == [], "Collection did not recover"
        finally:
            client.close()
    print("Bun LSP composition: external-module acquisition, export invalidation and recovery passed")
