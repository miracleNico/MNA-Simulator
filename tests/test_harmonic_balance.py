"""Regression tests for harmonic-balance setup."""

from __future__ import annotations

import numpy as np
import pytest

from mna_simulation.api.contracts import AnalysisMode
from mna_simulation.backends.python_backend import PythonBackend
from mna_simulation.errors import SolverConvergenceError


def _run_hb(netlist: str):
    backend = PythonBackend()
    circuit = backend.parse_text(netlist)
    options = backend.build_options(circuit, mode=AnalysisMode.HB)
    return backend.run(circuit, options)


def test_hb_uses_gcd_fundamental_for_multitone_sources() -> None:
    result = _run_hb(
        """
        V1 in 0 SIN 1 1k
        V2 in mid SIN 0.5 1.5k
        R1 mid 0 1k
        .hb 3
        .end
        """
    )

    assert result.spectrum is not None
    assert result.metadata["base_frequency_hz"] == pytest.approx(500.0)
    assert np.asarray(result.spectrum.frequencies).tolist() == pytest.approx([0.0, 500.0, 1000.0, 1500.0])

    labels = result.spectrum.labels
    magnitudes = np.asarray(result.spectrum.magnitudes)
    in_mags = magnitudes[labels.index("V(in)")]
    mid_mags = magnitudes[labels.index("V(mid)")]

    assert in_mags[1] == pytest.approx(0.0, abs=1e-9)
    assert in_mags[2] == pytest.approx(1.0, rel=1e-9)
    assert in_mags[3] == pytest.approx(0.0, abs=1e-9)
    assert mid_mags[2] == pytest.approx(1.0, rel=1e-9)
    assert mid_mags[3] == pytest.approx(0.5, rel=1e-9)


def test_hb_expands_harmonic_count_to_cover_highest_source() -> None:
    result = _run_hb(
        """
        V1 in 0 SIN 1 1k
        V2 in mid SIN 0.5 1.5k
        R1 mid 0 1k
        .hb 1
        .end
        """
    )

    assert result.spectrum is not None
    assert result.metadata["base_frequency_hz"] == pytest.approx(500.0)
    assert result.metadata["harmonics"] == 7
    assert result.spectrum.frequencies[3] == pytest.approx(1500.0)


def test_hb_requires_a_sinusoidal_source() -> None:
    with pytest.raises(SolverConvergenceError, match="No sinusoidal sources"):
        _run_hb(
            """
            V1 in 0 DC 1
            R1 in 0 1k
            .hb 3
            .end
            """
        )
