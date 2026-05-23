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


def test_hb_ghz_close_tone_diode_mixer_resolves_beat_without_long_transient() -> None:
    result = _run_hb(
        """
        IBIAS mix 0 DC 50u
        I1 mix 0 SIN 40u 1G
        I2 mix 0 SIN 40u 1.005G
        RLOAD mix 0 10k
        D1 mix 0 1e-12
        GENV env 0 mix 0 1m
        LENV env 0 1u
        CENV env 0 1.013n
        RQ env 0 4.3k
        .hb 205
        .end
        """
    )

    assert result.spectrum is not None
    assert result.metadata["base_frequency_hz"] == pytest.approx(5e6)
    assert result.metadata["harmonics"] == 205

    labels = result.spectrum.labels
    magnitudes = np.asarray(result.spectrum.magnitudes)
    mix_mags = magnitudes[labels.index("V(mix)")]
    env_mags = magnitudes[labels.index("V(env)")]

    assert "I(LENV)" in labels
    assert result.spectrum.frequencies[1] == pytest.approx(5e6)
    assert result.spectrum.frequencies[200] == pytest.approx(1e9)
    assert result.spectrum.frequencies[201] == pytest.approx(1.005e9)
    assert mix_mags[1] > 50e-3
    assert mix_mags[200] > 100e-3
    assert mix_mags[201] > 100e-3
    assert env_mags[1] > 300e-3
    assert env_mags[200] < 1e-3


def test_hb_ghz_close_tone_demo_reconstructs_steady_state_beat_window() -> None:
    result = _run_hb(
        """
        IBIAS mix 0 DC 50u
        I1 mix 0 SIN 40u 1G
        I2 mix 0 SIN 40u 1.005G
        RLOAD mix 0 10k
        D1 mix 0 1e-12
        GENV env 0 mix 0 1m
        LENV env 0 1u
        CENV env 0 1.013n
        RQ env 0 4.3k
        .hb 205 200n
        .end
        """
    )

    assert result.waveform is not None
    assert result.metadata["base_frequency_hz"] == pytest.approx(5e6)
    assert result.waveform.time[-1] == pytest.approx(200e-9)

    labels = result.waveform.labels
    values = np.asarray(result.waveform.values)
    mix_values = values[labels.index("V(mix)")]
    env_values = values[labels.index("V(env)")]
    assert np.ptp(mix_values) > 0.5
    assert np.ptp(env_values) > 0.6


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
