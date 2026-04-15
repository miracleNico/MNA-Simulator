"""Stable data contracts shared by parser, builder, solvers, API, and UI."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import numpy as np
from pydantic import BaseModel, Field


class AnalysisMode(str, Enum):
    SHOW_MATRIX = "show_matrix"
    OP = "op"
    TRAN = "tran"
    AC = "ac"
    HB = "hb"


@dataclass(slots=True)
class ComponentRecord:
    """Normalized component description independent of execution backend."""

    name: str
    type: str
    node1: str | None
    node2: str | None
    value: str | None
    subtype: str | None = None
    ctrl_node1: str | None = None
    ctrl_node2: str | None = None
    ctrl_source: str | None = None
    value2: str | None = None
    value3: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class CircuitIR:
    """Validated circuit representation used across all layers."""

    components: list[ComponentRecord]
    directives: list["DirectiveRecord"] = field(default_factory=list)
    source_text: str = ""


@dataclass(slots=True)
class DirectiveRecord:
    """Structured simulation directive parsed from netlist text or CLI flags."""

    mode: AnalysisMode
    params: dict[str, Any] = field(default_factory=dict)
    raw_line: str = ""


@dataclass(slots=True)
class AnalysisOptions:
    """Numerical options supplied by CLI/API/UI."""

    mode: AnalysisMode
    gmin_steps: list[float] = field(default_factory=lambda: [0.0])
    max_iter: int = 10000
    v_tol: float = 1e-9
    f_tol: float = 1e-9
    tran_stop: float | None = None
    tran_step: float | None = None
    ac_start: float | None = None
    ac_stop: float | None = None
    ac_points: int | None = None
    hb_harmonics: int | None = None
    hb_time_window: float | None = None
    init_condition: np.ndarray | str | None = None


@dataclass(slots=True)
class IndexMap:
    """Stable name/index map returned from MNA assembly."""

    node_names: list[str]
    branch_names: list[str]
    node_to_index: dict[str, int]
    branch_to_index: dict[str, int]


@dataclass(slots=True)
class MnaProblem:
    """Matrix-form circuit problem consumed by solver backends."""

    G: np.ndarray
    C: np.ndarray
    f_str: np.ndarray
    b_dc: np.ndarray
    b_ac: np.ndarray
    b_time_str: np.ndarray
    index_map: IndexMap
    components: list[ComponentRecord]
    gmin: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class WaveformResult:
    """Time-domain result series."""

    time: np.ndarray
    values: np.ndarray
    labels: list[str]


@dataclass(slots=True)
class SpectrumResult:
    """Frequency-domain result series."""

    frequencies: np.ndarray
    magnitudes: np.ndarray
    labels: list[str]


@dataclass(slots=True)
class SimulationResult:
    """Backend-neutral simulation result envelope."""

    mode: AnalysisMode
    status: str
    dc_solution: np.ndarray | None = None
    waveform: WaveformResult | None = None
    spectrum: SpectrumResult | None = None
    harmonic_state: np.ndarray | None = None
    matrices: dict[str, np.ndarray] | None = None
    labels: list[str] = field(default_factory=list)
    diagnostics: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class BackendCapabilities:
    """Feature flags surfaced by a backend adapter."""

    supports_behavioral_sources: bool = True
    supports_harmonic_balance: bool = True
    supports_sparse_linear_solver: bool = False
    supports_cpp_acceleration: bool = False


class AnalysisRequest(BaseModel):
    """HTTP/API request payload."""

    netlist_text: str = Field(default="", description="Raw netlist text.")
    mode: AnalysisMode | None = Field(default=None)
    options: dict[str, Any] = Field(default_factory=dict)
    schematic: dict[str, Any] | None = None


class SimulationResponse(BaseModel):
    """HTTP/API response payload."""

    mode: AnalysisMode
    status: str
    labels: list[str] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    dc_solution: list[float] | None = None
    waveform: dict[str, Any] | None = None
    spectrum: dict[str, Any] | None = None
    matrices: dict[str, object] | None = None
