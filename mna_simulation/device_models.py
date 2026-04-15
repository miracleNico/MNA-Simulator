"""Built-in device stamp helpers and behavioral source expressions."""

from __future__ import annotations

import numpy as np

from .api.contracts import ComponentRecord
from .utils import parse_value

V_T = "0.025"


def source_expression(component: ComponentRecord) -> str:
    """Build the time-domain expression string for a source."""

    subtype = (component.subtype or "").upper()
    amplitude = parse_value(component.value or "0")

    if subtype == "SIN":
        frequency = parse_value(component.value2 or "0")
        return f"({amplitude} * np.sin(2 * np.pi * {frequency} * t))"

    if subtype == "COS":
        frequency = parse_value(component.value2 or "0")
        return f"({amplitude} * np.cos(2 * np.pi * {frequency} * t))"

    if subtype == "STEP":
        if component.value3 is None:
            t_step = parse_value(component.value2 or "0")
            return f"({amplitude} * np.heaviside(t - {t_step}, 1))"
        frequency = parse_value(component.value2 or "0")
        period = 1.0 / frequency
        duty_cycle = min(parse_value(component.value3), 1.0)
        t_step = (1.0 - duty_cycle) * period
        waveform = f"np.heaviside(np.mod(t, {period}) - {t_step}, 1)"
        return f"({amplitude} * {waveform})"

    if subtype == "FUNC":
        period = parse_value(component.value or "0")
        expression = component.value2 or "0"
        if period == 0:
            return f"({expression})"
        return f"({expression.replace('t', f'np.mod(t, {period})')})"

    return "0"


def diode_current_expression(component: ComponentRecord, j_expr: str, k_expr: str) -> str:
    """Build a diode current expression string."""

    saturation_current = parse_value(component.value or "1e-15")
    voltage_expr = f"({j_expr} - {k_expr})"
    return f"({saturation_current} * (np.exp({voltage_expr} / {V_T}) - 1))"
