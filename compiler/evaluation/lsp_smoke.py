"""Fast maintained Bun LSP acceptance gate; Go and all modes run in the dedicated job."""
import tempfile
from pathlib import Path
from lsp_suite import run_session

with tempfile.TemporaryDirectory(prefix="chess-lsp-") as folder:
    result = run_session(["bun", "src/adapters/lsp.ts", "--stdio"], Path(__file__).resolve().parent.parent,
                         Path(folder), iterations=1)
    assert not result["failures"], result["failures"]
    print(f"Bun LSP: {len(result['checks'])} shared acceptance checks passed")

from lsp_sources import run as run_source_checks, configuration_health, alias_health
run_source_checks()

configuration_health()

alias_health()

from lsp_markdown import run as run_markdown_checks, composition as run_composition_checks
run_markdown_checks()

run_composition_checks()
