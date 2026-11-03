"""Fast maintained Bun LSP acceptance gate; Go and all modes run in the dedicated job."""
import tempfile
from pathlib import Path
from lsp_suite import run_session

with tempfile.TemporaryDirectory(prefix="chess-lsp-") as folder:
    result = run_session(["bun", "src/adapters/lsp.ts", "--stdio"], Path(__file__).resolve().parent.parent,
                         Path(folder), iterations=1)
    assert not result["failures"], result["failures"]
    print(f"Bun LSP: {len(result['checks'])} shared acceptance checks passed")
