from __future__ import annotations

from mna_simulation.api.contracts import AnalysisMode, AnalysisRequest
from mna_simulation.api.service import SimulationService


def test_service_returns_matrix_payload() -> None:
    service = SimulationService()
    response = service.run_request(
        AnalysisRequest(
            netlist_text="""
            V1 n1 0 DC 5
            R1 n1 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.SHOW_MATRIX,
        )
    )

    assert response.status == "ok"
    assert response.matrices is not None
    assert "G" in response.matrices


def test_service_returns_dc_solution() -> None:
    service = SimulationService()
    response = service.run_request(
        AnalysisRequest(
            netlist_text="""
            V1 n1 0 DC 5
            R1 n1 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.OP,
        )
    )

    assert response.status == "ok"
    assert response.dc_solution is not None
    assert len(response.dc_solution) == 2
