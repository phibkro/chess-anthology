"""Deadline-bound LSP wire client; preserves notifications and handles server requests."""
import json
import os
import select
import subprocess
import time


class Client:
    def __init__(self, command, cwd, env=None):
        self.process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.buffer = b""
        self.pending = []
        self.stderr = b""
        self.sequence = 0
        self.versioned = True
        self.timeout = 15
        self.transcript = []

    def send(self, message, fragmented=False):
        self.transcript.append({"direction": "send", "message": message})
        data = json.dumps(dict(jsonrpc="2.0", **message), ensure_ascii=True).encode()
        packet = f"Content-Length: {len(data)}\r\n\r\n".encode() + data
        if fragmented:
            for chunk in [packet[:7], packet[7:23], packet[23:]]:
                self.process.stdin.write(chunk)
                self.process.stdin.flush()
        else:
            self.process.stdin.write(packet)
            self.process.stdin.flush()

    def notify(self, method, params):
        self.send({"method": method, "params": params})

    def receive(self, predicate, timeout=None):
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        while True:
            for i, item in enumerate(self.pending):
                if predicate(item):
                    return self.pending.pop(i)
            while b"\r\n\r\n" in self.buffer:
                header, body = self.buffer.split(b"\r\n\r\n", 1)
                lengths = [int(line.split(b":", 1)[1]) for line in header.split(b"\r\n")
                           if line.lower().startswith(b"content-length:")]
                if len(lengths) != 1 or lengths[0] > 16_000_000:
                    raise AssertionError("Invalid LSP frame")
                length = lengths[0]
                if len(body) < length:
                    break
                message = json.loads(body[:length])
                self.buffer = body[length:]
                self.transcript.append({"direction": "receive", "message": message})
                if "method" in message and "id" in message:
                    method = message["method"]
                    if method == "workspace/configuration":
                        result = [{} for _ in message.get("params", {}).get("items", [])]
                    elif method in ["client/registerCapability", "window/workDoneProgress/create"]:
                        result = None
                    else:
                        self.send({"id": message["id"], "error": {"code": -32601, "message": "Unsupported client method"}})
                        continue
                    self.send({"id": message["id"], "result": result})
                elif predicate(message):
                    return message
                else:
                    self.pending.append(message)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"LSP timeout; stderr={self.stderr.decode(errors='replace')}")
            ready, _, _ = select.select([self.process.stdout, self.process.stderr], [], [], min(remaining, .5))
            for stream in ready:
                data = os.read(stream.fileno(), 65536)
                if stream is self.process.stderr:
                    self.stderr = (self.stderr + data)[-65536:]
                elif data:
                    self.buffer += data
                else:
                    raise AssertionError(f"LSP EOF ({self.process.poll()}): {self.stderr.decode(errors='replace')}")

    def request(self, method, params, fragmented=False):
        self.sequence += 1
        identifier = self.sequence
        self.send({"id": identifier, "method": method, "params": params}, fragmented)
        message = self.receive(lambda m: m.get("id") == identifier and "method" not in m)
        if "error" in message:
            raise AssertionError(message)
        return message.get("result")

    def diagnostics(self, uri, version=None, predicate=lambda ds: True):
        return self.receive(lambda m: m.get("method") == "textDocument/publishDiagnostics"
                            and m["params"]["uri"] == uri
                            and (version is None or not self.versioned or m["params"].get("version") == version)
                            and predicate(m["params"]["diagnostics"]))["params"]["diagnostics"]

    def close(self):
        try:
            if self.process.poll() is not None:
                raise AssertionError(f"LSP exited {self.process.returncode}")
            if self.process.poll() is None:
                self.request("shutdown", None)
                self.notify("exit", None)
                code = self.process.wait(timeout=5)
                if code != 0:
                    raise AssertionError(f"LSP shutdown exit {code}")
        finally:
            if self.process.poll() is None:
                self.process.kill()
            self.process.wait()
            for stream in [self.process.stdin, self.process.stdout, self.process.stderr]:
                stream.close()
