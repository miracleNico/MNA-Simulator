"""Simple profiling entry point for the rebuilt basic solver path."""

from __future__ import annotations

import time

from mna_simulation.api.contracts import AnalysisMode
from mna_simulation.backends.python_backend import PythonBackend

NETLIST = """
V1 n1 0 DC 10
R1 n1 n2 1k
R2 n2 0 2k
C1 n2 0 1u
.tran 10m 0.1m
.end
"""


def main() -> None:
    backend = PythonBackend()
    circuit = backend.parse_text(NETLIST)
    options = backend.build_options(circuit, mode=AnalysisMode.TRAN)

    start = time.perf_counter()
    result = backend.run(circuit, options)
    elapsed = time.perf_counter() - start

    print(f"mode={result.mode} elapsed_s={elapsed:.6f} labels={len(result.labels)}")


if __name__ == "__main__":
    main()
