"""Shared LSP acceptance cases; timings include IPC and matching diagnostic delivery."""
import time
from lsp_client import Client

STORY = '''module lesson;
import "./library.chess-story";
story opening {
 board first game sample after 0 {
  text "A human idea ♞";
  prompt "Choose a move." answer "e4";
 }
}
'''
LIBRARY = 'module library;\nexport game sample from "./game.pgn";\n'
PGN = '[Event "LSP fixture"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *\n'


def fixture(root, size):
    root.mkdir(parents=True, exist_ok=True)
    for old in root.glob("story*.chess-story"):
        old.unlink()
    (root / "library.chess-story").write_text(LIBRARY)
    (root / "game.pgn").write_text(PGN)
    for i in range(size):
        (root / f"story{i}.chess-story").write_text(STORY.replace("module lesson;", f"module lesson{i};"))


def position(text, needle, delta=0):
    prefix = text[:text.index(needle) + delta]
    return {"line": prefix.count("\n"), "character": len(prefix.rsplit("\n", 1)[-1].encode("utf-16-le", errors="surrogatepass")) // 2}


def expect(value, message):
    if not value:
        raise AssertionError(message)


def run_session(command, cwd, root, size=1, iterations=3, extended=True, env=None, versioned=True):
    fixture(root, size)
    uri = (root / "story0.chess-story").as_uri()
    library = (root / "library.chess-story").as_uri()
    pgn = (root / "game.pgn").as_uri()
    text = (root / "story0.chess-story").read_text()
    timings, checks, failures = {}, [], {}
    started = time.perf_counter_ns()
    client = Client(command, cwd, env)
    client.versioned = versioned
    if not versioned:
        client.timeout = 3
    def measure(name, operation):
        before = time.perf_counter_ns()
        value = operation()
        timings.setdefault(name, []).append((time.perf_counter_ns() - before) / 1e6)
        return value
    def check(name, operation):
        try:
            operation()
            checks.append(name)
        except (AssertionError, BrokenPipeError, TimeoutError) as error:
            failures[name] = str(error)
    version = 1
    def change(new_text, changes=None):
        nonlocal version, text
        version += 1
        client.notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": version},
                      "contentChanges": changes if changes is not None else [{"text": new_text}]})
        text = new_text
        return client.diagnostics(uri, version)
    def clean(new_text):
        expect(change(new_text) == [], "Expected clean document")
    try:
        initialize = client.request("initialize", {"processId": None, "rootUri": root.as_uri(), "capabilities": {
            "workspace": {"didChangeWatchedFiles": {"dynamicRegistration": True}}, "general": {"positionEncodings": ["utf-16"]}, "textDocument": {"publishDiagnostics": {"versionSupport": True}}},
            "workspaceFolders": [{"uri": root.as_uri(), "name": "fixture"}]}, fragmented=True)
        timings["initialize"] = [(time.perf_counter_ns() - started) / 1e6]
        expect(initialize["capabilities"].get("definitionProvider"), "Missing definition capability")
        client.notify("initialized", {})
        def opening():
            client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "chess-narrative", "version": 1, "text": text}})
            expect(client.diagnostics(uri, 1) == [], "Valid imported game diagnostics")
        measure("open", opening)
        timings["firstDiagnostics"] = [(time.perf_counter_ns() - started) / 1e6]
        checks += ["initialize-fragmented-frame", "imported-game-open"]
        if not versioned:
            failures["versioned-diagnostics"] = "Historical Langium server omits version; sequential single-edit comparisons only"
        for i in range(iterations):
            measure("proseEdit", lambda: clean(text.replace("human idea", f"human idea{i}")))
            def syntax():
                expect(len(change(text + " @")) > 0, "Missing syntax diagnostic")
            measure("syntaxError", syntax)
            measure("recovery", lambda: clean(text[:-2]))
            def completion():
                result = client.request("textDocument/completion", {"textDocument": {"uri": uri}, "position": position(text, 'answer "e4"', len('answer "e'))})
                items = result.get("items", []) if isinstance(result, dict) else result or []
                item = next((v for v in items if v["label"] == "e4"), None)
                expect(item is not None and item.get("detail") == "e2e4", "Legal SAN completion missing")
                expect(item["textEdit"]["newText"] == "e4", "Completion edit")
                expect(item["textEdit"]["range"] == {"start": position(text, 'answer "e4"', len('answer "')), "end": position(text, 'answer "e4"', len('answer "e4'))}, "Completion UTF-16 range")
            measure("completion", completion)
            def definition():
                result = client.request("textDocument/definition", {"textDocument": {"uri": uri}, "position": position(text, "game sample", len("game sa"))})
                locations = result if isinstance(result, list) else [result]
                expect(any(v and v.get("uri", v.get("targetUri")) == library for v in locations), "Imported game definition missing")
            measure("definition", definition)
        checks += ["prose-edit", "syntax-error-recovery", "legal-san-completion", "imported-definition"]
        def no_definition():
            result = client.request("textDocument/definition", {"textDocument": {"uri": uri}, "position": {"line": 0, "character": 0}})
            expect(result is None or result == [], "Expected no definition on module keyword")
        check("no-definition-null", no_definition)
        def cancel():
            client.sequence += 1
            identifier = client.sequence
            client.send({"id": identifier, "method": "textDocument/completion", "params": {"textDocument": {"uri": uri}, "position": position(text, 'answer "e4"', len('answer "e'))}})
            client.notify("$/cancelRequest", {"id": identifier})
            response = client.receive(lambda m: m.get("id") == identifier and "method" not in m)
            expect("result" in response or response.get("error", {}).get("code") == -32800, "Unexpected cancellation response")
            no_definition()
        check("cancellation-health", cancel)
        def illegal():
            diagnostics = change(text.replace('answer "e4"', 'answer "e5"'))
            expected_range = {"start": position(text, 'answer "e5"', len('answer ')), "end": position(text, 'answer "e5"', len('answer "e5"'))}
            expect(any(d.get("code") == "chess/illegal-answer" and d.get("severity") == 1 and d["range"] == expected_range for d in diagnostics), "Missing illegal-answer diagnostic/range")
            clean(text.replace('answer "e5"', 'answer "e4"'))
        check("illegal-answer-recovery", illegal)
        def utf16():
            clean(text.replace('human idea', 'human 😀 idea').replace('prompt "Choose', 'prompt "😀 Choose').replace("\n", "\r\n"))
            start = position(text, "😀")
            end = dict(start, character=start["character"] + 2)
            replacement = text.replace("😀", "♟", 1)
            expect(change(replacement, [{"range": {"start": start, "end": end}, "text": "♟"}]) == [], "UTF-16 incremental edit failed")
            start = position(text, 'answer "e4"', len('answer "'))
            end = dict(start, character=start["character"] + 2)
            replacement = text.replace('answer "e4"', 'answer "e5"')
            diagnostics = change(replacement, [{"range": {"start": start, "end": end}, "text": "e5"}])
            expected = {"start": dict(start, character=start["character"] - 1), "end": dict(end, character=end["character"] + 1)}
            expect(any(d.get("code") == "chess/illegal-answer" and d["range"] == expected for d in diagnostics), "UTF-16 edit did not change answer semantics/range")
            clean(text.replace('answer "e5"', 'answer "e4"'))
        check("utf16-crlf-edit", utf16)
        if versioned:
            def burst():
                nonlocal version
                client.notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": version + 1}, "contentChanges": [{"text": text + " @"}]})
                version += 2
                client.notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": text}]})
                expect(client.diagnostics(uri, version) == [], "Stale diagnostics mislabeled as latest version")
            check("rapid-edit-latest-version", burst)
        if extended:
            client.notify("textDocument/didOpen", {"textDocument": {"uri": library, "languageId": "chess-narrative", "version": 1, "text": LIBRARY}})
            expect(client.diagnostics(library, 1) == [], "Library open")
            def fence():
                # An ordered request consumes earlier wire output; discard obsolete publications.
                client.request("textDocument/definition", {"textDocument": {"uri": uri}, "position": position(text, "game sample", len("game sa"))})
                client.pending[:] = [m for m in client.pending if not (m.get("method") == "textDocument/publishDiagnostics" and m["params"]["uri"] == library)]
            def watched():
                # Regression: a retained old clean publication must not count as recovery.
                client.pending.append({"method": "textDocument/publishDiagnostics", "params": {"uri": library, "diagnostics": [], "testStale": True}})
                fence()
                expect(not any(m.get("params", {}).get("testStale") for m in client.pending), "Stale diagnostics survived fence")
                (root / "game.pgn").write_text("1. e5 *")
                client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": pgn, "type": 2}]})
                expect(any(d.get("code") == "chess/invalid-game" for d in client.diagnostics(library, predicate=bool)), "PGN invalidation missing")
                fence()
                (root / "game.pgn").write_text(PGN)
                client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": pgn, "type": 2}]})
                expect(client.diagnostics(library, predicate=lambda ds: not ds) == [], "PGN recovery missing")
            check("watched-pgn-recovery", lambda: measure("watchedPgnRoundtrip", watched))
            def overlay():
                fence()
                client.notify("textDocument/didOpen", {"textDocument": {"uri": pgn, "languageId": "pgn", "version": 1, "text": "1. e5 *"}})
                expect(any(d.get("code") == "chess/invalid-game" for d in client.diagnostics(library, predicate=bool)), "Unsaved PGN overlay ignored")
                fence()
                client.notify("textDocument/didClose", {"textDocument": {"uri": pgn}})
                expect(client.diagnostics(library, predicate=lambda ds: not ds) == [], "PGN disk restoration missing")
            check("pgn-overlay-close", overlay)
            def deletion():
                broken = root / "broken.chess-story"
                broken.write_text('module broken; game missing from "./absent.pgn";')
                target = broken.as_uri()
                client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": target, "type": 1}]})
                expect(client.diagnostics(target, predicate=bool), "Expected source diagnostic on created module")
                client.request("textDocument/definition", {"textDocument": {"uri": uri}, "position": {"line": 0, "character": 0}})
                client.pending[:] = [m for m in client.pending if not (m.get("method") == "textDocument/publishDiagnostics" and m["params"]["uri"] == target)]
                broken.unlink()
                client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": target, "type": 3}]})
                expect(client.diagnostics(target, predicate=lambda ds: not ds) == [], "Deleted module diagnostics not cleared")
                broken.write_text('module broken;')
                client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": target, "type": 1}]})
                expect(client.diagnostics(target) == [], "Recreated module has stale diagnostics")
                broken.unlink()
                client.notify("workspace/didChangeWatchedFiles", {"changes": [{"uri": target, "type": 3}]})
            check("module-create-delete-recreate", deletion)
    except Exception:
        (root / "failure-transcript.json").write_text(__import__("json").dumps(client.transcript, indent=2))
        raise
    finally:
        try:
            client.close()
            checks.append("shutdown-exit")
        except Exception as error:
            failures["shutdown-exit"] = str(error)
    return {"timingsMs": timings, "checks": checks, "failures": failures, "transcript": client.transcript}
