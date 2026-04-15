"""Netlist parsing and validation."""

from __future__ import annotations

import collections
import re
from dataclasses import dataclass, field
from pathlib import Path

from .api.contracts import AnalysisMode, CircuitIR, ComponentRecord, DirectiveRecord
from .errors import NetlistError, error_handler
from .utils import parse_value

V_T = "0.025"
I_S = "1e-15"


@dataclass(slots=True)
class Component:
    """Validated component parsed from a netlist line."""

    name: str
    node1: str | None = None
    node2: str | None = None
    value: str | None = None
    subtype: str | None = None
    ctrl_node1: str | None = None
    ctrl_node2: str | None = None
    ctrl_source: str | None = None
    value2: str | None = None
    value3: str | None = None
    type: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)

    TYPE = r"(R|C|V|L|I|VCCS|VCVS|CCCS|CCVS|E|F|G|H|D|B)"
    NUMBER = r"[+-]?(\d+(\.\d*)?|\.\d+)"
    SCIENTIFIC_NOTATION = r"([eE][+-]?\d+)"
    METRIC_SUFFIXES = r"(u|U|m|M|k|K|Meg|MEG|G|N|P|F|%)"
    COMPONENT_PATTERN = re.compile(rf"^({TYPE}\d+)$", re.IGNORECASE)
    INDEPENDENT_VAL_PATTERN = re.compile(f"^{NUMBER}({SCIENTIFIC_NOTATION}|{METRIC_SUFFIXES})?$")
    DEPENDENT_VAL_PATTERN = re.compile(f"^{NUMBER}({SCIENTIFIC_NOTATION}|{METRIC_SUFFIXES})?$")
    NODE_PATTERN = re.compile(r"^(0|n\d+)$", re.IGNORECASE)
    DUTY_CYCLE = re.compile(r"^(\d+(\.\d*)?|\.\d+)(%)?$")

    @classmethod
    def from_parts(cls, parts: list[str]) -> "Component":
        """Create and validate a component from netlist tokens."""

        if not parts:
            error_handler("NETLIST_FATAL: Empty component definition.")

        name = parts[0]
        if not cls.COMPONENT_PATTERN.match(name):
            error_handler(f"COMPONENT_ERROR: Invalid component name: '{name}'")

        component = cls(name=name)
        component.type = component.get_type(name)

        if component.type in {"R", "C", "L"}:
            cls._parse_passive(component, parts)
        elif component.type in {"V", "I"}:
            cls._parse_source(component, parts)
        elif component.type in {"VCVS", "VCCS", "CCVS", "CCCS"}:
            cls._parse_dependent(component, parts)
        elif component.type == "D":
            cls._parse_diode(component, parts)
        elif component.type == "B":
            cls._parse_behavioral(component, parts)
        else:
            error_handler("NETLIST_FATAL: Unknown component or name format")

        component.validate()
        return component

    @staticmethod
    def get_type(name: str) -> str | None:
        """Infer the normalized type from the device name prefix."""

        upper_name = name.upper()
        for prefix, normalized in (
            ("VCVS", "VCVS"),
            ("VCCS", "VCCS"),
            ("CCVS", "CCVS"),
            ("CCCS", "CCCS"),
            ("R", "R"),
            ("C", "C"),
            ("L", "L"),
            ("V", "V"),
            ("I", "I"),
            ("E", "VCVS"),
            ("G", "VCCS"),
            ("F", "CCCS"),
            ("H", "CCVS"),
            ("D", "D"),
            ("B", "B"),
        ):
            if upper_name.startswith(prefix):
                return normalized
        return None

    @classmethod
    def _parse_passive(cls, component: "Component", parts: list[str]) -> None:
        if len(parts) != 4:
            error_handler(f"NETLIST_FATAL: '{component.name}' expected 4 parts, got {len(parts)}")
        component.node1, component.node2, component.value = parts[1], parts[2], parts[3]
        cls._validate_distinct_nodes(component)

    @classmethod
    def _parse_source(cls, component: "Component", parts: list[str]) -> None:
        if len(parts) < 5:
            error_handler(f"COMPONENT_ERROR: '{component.name}' expected at least 5 parts, got {len(parts)}")

        component.node1 = parts[1]
        component.node2 = parts[2]
        component.subtype = parts[3].upper()
        cls._validate_distinct_nodes(component)

        if component.subtype == "DC":
            if len(parts) != 5:
                error_handler(f"COMPONENT_ERROR: '{component.name}' expected 5 parts, got {len(parts)}")
            component.value = parts[4]
        elif component.subtype == "AC":
            if len(parts) != 5:
                error_handler(f"COMPONENT_ERROR: '{component.name}' expected 5 parts, got {len(parts)}")
            component.value = parts[4]
        elif component.subtype in {"SIN", "COS"}:
            if len(parts) != 6:
                error_handler(f"COMPONENT_ERROR: '{component.name}' expected 6 parts, got {len(parts)}")
            component.value = parts[4]
            component.value2 = parts[5]
        elif component.subtype == "STEP":
            if len(parts) not in {6, 7}:
                error_handler(f"COMPONENT_ERROR: '{component.name}' expected 6 or 7 parts, got {len(parts)}")
            component.value = parts[4]
            component.value2 = parts[5]
            component.value3 = parts[6] if len(parts) == 7 else None
        elif component.subtype == "FUNC":
            if len(parts) != 6:
                error_handler(f"COMPONENT_ERROR: '{component.name}' expected 6 parts, got {len(parts)}")
            component.value = parts[4]
            component.value2 = parts[5]
        else:
            error_handler(
                f"COMPONENT_ERROR: '{component.name}' has invalid subtype '{component.subtype}'."
            )

    @classmethod
    def _parse_dependent(cls, component: "Component", parts: list[str]) -> None:
        expected = 6 if component.type in {"VCVS", "VCCS"} else 5
        if len(parts) != expected:
            error_handler(f"COMPONENT_ERROR: '{component.name}' expected {expected} parts, got {len(parts)}")
        component.node1 = parts[1]
        component.node2 = parts[2]
        cls._validate_distinct_nodes(component)
        if component.type in {"VCVS", "VCCS"}:
            component.ctrl_node1 = parts[3]
            component.ctrl_node2 = parts[4]
            component.value = parts[5]
            if component.ctrl_node1 == component.ctrl_node2:
                error_handler(
                    f"COMPONENT_ERROR: '{component.name}' control nodes must be different."
                )
        else:
            component.ctrl_source = parts[3]
            component.value = parts[4]

    @classmethod
    def _parse_diode(cls, component: "Component", parts: list[str]) -> None:
        if len(parts) not in {3, 4}:
            error_handler(f"COMPONENT_ERROR: '{component.name}' expected 3 or 4 parts, got {len(parts)}")
        component.node1 = parts[1]
        component.node2 = parts[2]
        component.value = parts[3] if len(parts) == 4 else I_S
        cls._validate_distinct_nodes(component)

    @classmethod
    def _parse_behavioral(cls, component: "Component", parts: list[str]) -> None:
        if len(parts) != 4:
            error_handler(f"COMPONENT_ERROR: '{component.name}' expected 4 parts, got {len(parts)}")
        component.node1 = parts[1]
        component.node2 = parts[2]
        component.value = parts[3]
        cls._validate_distinct_nodes(component)

    @staticmethod
    def _validate_distinct_nodes(component: "Component") -> None:
        if component.node1 == component.node2:
            error_handler(
                f"COMPONENT_ERROR: '{component.name}' has conflict in nodes: '{component.node1, component.node2}'"
            )

    def validate(self) -> bool:
        """Validate node names and parameter shapes."""

        if self.type is None:
            error_handler(f"NETLIST_FATAL: '{self.name}' has unknown component type.")

        nodes_to_check = [self.node1, self.node2]
        if self.ctrl_node1 is not None:
            nodes_to_check.append(self.ctrl_node1)
        if self.ctrl_node2 is not None:
            nodes_to_check.append(self.ctrl_node2)

        for node in nodes_to_check:
            if node is None or not self.NODE_PATTERN.match(node):
                error_handler(
                    f"NETLIST_FATAL: '{self.name}' has invalid node name '{node}'. Must be '0' or 'n#'."
                )

        if self.type in {"V", "I"}:
            if self.subtype not in {"AC", "COS", "SIN", "DC", "FUNC", "STEP"}:
                error_handler(f"NETLIST_FATAL: '{self.name}' has invalid subtype '{self.subtype}'.")
            if self.subtype in {"DC", "AC"} and not self.INDEPENDENT_VAL_PATTERN.match(self.value or ""):
                error_handler(f"NETLIST_FATAL: '{self.name}' has invalid value '{self.value}'.")
            if self.subtype in {"SIN", "COS", "STEP"}:
                if not self.DEPENDENT_VAL_PATTERN.match(self.value or ""):
                    error_handler(f"NETLIST_FATAL: '{self.name}' has invalid source value '{self.value}'.")
                if not self.DEPENDENT_VAL_PATTERN.match(self.value2 or ""):
                    error_handler(f"NETLIST_FATAL: '{self.name}' has invalid parameter '{self.value2}'.")
                if self.subtype == "STEP" and self.value3 is not None and not self.DUTY_CYCLE.match(self.value3):
                    error_handler(f"NETLIST_FATAL: '{self.name}' has invalid duty cycle '{self.value3}'.")
            return True

        if self.type in {"R", "C", "L", "D"}:
            if not self.INDEPENDENT_VAL_PATTERN.match(self.value or ""):
                error_handler(f"NETLIST_FATAL: '{self.name}' has invalid value format '{self.value}'.")
            return True

        if self.type in {"VCVS", "VCCS", "CCVS", "CCCS"}:
            if self.type in {"VCVS", "VCCS"} and not self.DEPENDENT_VAL_PATTERN.match(self.value or ""):
                error_handler(f"NETLIST_FATAL: '{self.name}' has invalid gain value '{self.value}'.")
            if self.type in {"CCVS", "CCCS"}:
                if not self.COMPONENT_PATTERN.match(self.ctrl_source or ""):
                    error_handler(f"NETLIST_FATAL: '{self.name}' has invalid controlling source '{self.ctrl_source}'.")
                if not self.DEPENDENT_VAL_PATTERN.match(self.value or ""):
                    error_handler(f"NETLIST_FATAL: '{self.name}' has invalid gain value '{self.value}'.")
            return True

        if self.type == "B":
            if not self.value:
                error_handler(f"NETLIST_FATAL: '{self.name}' requires an expression.")
            return True

        error_handler(f"NETLIST_FATAL: '{self.name}'. Could not validate component.")

    def to_record(self) -> ComponentRecord:
        """Convert to the backend-neutral component record."""

        return ComponentRecord(
            name=self.name,
            type=self.type or "",
            node1=self.node1,
            node2=self.node2,
            value=self.value,
            subtype=self.subtype,
            ctrl_node1=self.ctrl_node1,
            ctrl_node2=self.ctrl_node2,
            ctrl_source=self.ctrl_source,
            value2=self.value2,
            value3=self.value3,
            metadata=dict(self.metadata),
        )


@dataclass(slots=True)
class Netlist:
    """Validated netlist container."""

    components: list[Component] = field(default_factory=list)
    voltage_source_node_sets: list[frozenset[str]] = field(default_factory=list)
    current_source_nodes: list[str] = field(default_factory=list)
    other_nodes: list[str] = field(default_factory=list)

    def add_component(self, component: Component) -> None:
        self.components.append(component)
        if component.type in {"V", "CCVS", "VCVS"}:
            self.voltage_source_node_sets.append(frozenset([component.node1 or "0", component.node2 or "0"]))
            if component.ctrl_node1:
                self.other_nodes.extend([component.ctrl_node1, component.ctrl_node2 or "0"])
        elif component.type in {"I", "VCCS", "CCCS"}:
            self.current_source_nodes.extend([component.node1 or "0", component.node2 or "0"])
            if component.ctrl_node1:
                self.other_nodes.extend([component.ctrl_node1, component.ctrl_node2 or "0"])
        else:
            self.other_nodes.extend([component.node1 or "0", component.node2 or "0"])

    def validate(self) -> bool:
        """Validate netlist-wide topological constraints."""

        if self.voltage_source_node_sets and len(self.voltage_source_node_sets) > len(set(self.voltage_source_node_sets)):
            error_handler("NETLIST_FATAL: Voltage source parallel conflict: Two or more voltage sources are in parallel.")

        if self.current_source_nodes:
            counts = collections.Counter(self.current_source_nodes)
            junction_nodes = {node for node, count in counts.items() if count > 1}
            other_nodes_set = set(self.other_nodes)
            conflict_nodes = junction_nodes - junction_nodes.intersection(other_nodes_set)
            if conflict_nodes:
                error_handler(
                    f"NETLIST_FATAL: Current source series conflict: Node(s) {conflict_nodes} are the only junctions for series current sources."
                )
        return True

    def to_ir(self, directives: list[DirectiveRecord], source_text: str) -> CircuitIR:
        """Convert to the shared IR."""

        return CircuitIR(
            components=[component.to_record() for component in self.components],
            directives=directives,
            source_text=source_text,
        )


def parse_directive(line: str) -> DirectiveRecord:
    """Parse a single simulator directive line."""

    parts = line.split()
    command = parts[0].lower()

    if command == ".op" or command == ".dc":
        return DirectiveRecord(mode=AnalysisMode.OP, raw_line=line)

    if command == ".tran":
        if len(parts) not in {2, 3}:
            error_handler("NETLIST_FATAL: Use .tran <time> (<step_time>).")
        params = {"t_stop": parse_value(parts[1]), "t_step": parse_value(parts[2]) if len(parts) == 3 else parse_value("0.01m")}
        return DirectiveRecord(mode=AnalysisMode.TRAN, params=params, raw_line=line)

    if command == ".ac":
        if len(parts) != 4:
            error_handler("NETLIST_FATAL: Use .ac <start_freq> <stop_freq> <points>.")
        params = {
            "f_start": parse_value(parts[1]),
            "f_stop": parse_value(parts[2]),
            "points": int(parse_value(parts[3])),
        }
        return DirectiveRecord(mode=AnalysisMode.AC, params=params, raw_line=line)

    if command == ".hb":
        params: dict[str, float | int] = {"harmonics": 16}
        args = parts[1:]
        if len(args) == 1:
            if re.match(r"^\d+$", args[0]):
                params["harmonics"] = int(args[0])
            else:
                params["time_window"] = parse_value(args[0])
        elif len(args) >= 2:
            params["harmonics"] = int(parse_value(args[0]))
            params["time_window"] = parse_value(args[1])
        return DirectiveRecord(mode=AnalysisMode.HB, params=params, raw_line=line)

    error_handler(f"NETLIST_FATAL: Unsupported directive '{line}'.")


def parse_netlist_text(netlist_text: str) -> CircuitIR:
    """Parse multiline netlist text into a validated IR."""

    netlist = Netlist()
    directives: list[DirectiveRecord] = []
    lines = netlist_text.splitlines()

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("*") or line.startswith("#"):
            continue
        if line.lower() == ".end":
            break
        if line.startswith("."):
            directives.append(parse_directive(line))
            continue

        parts = line.split()
        component = Component.from_parts(parts)
        netlist.add_component(component)

    if not netlist.components:
        raise NetlistError("No components entered in netlist.")

    netlist.validate()
    return netlist.to_ir(directives=directives, source_text=netlist_text)


def parse_netlist_file(path: str | Path) -> CircuitIR:
    """Parse a netlist from a `.cir`/`.sp` file."""

    text = Path(path).read_text(encoding="utf-8")
    return parse_netlist_text(text)


def select_analysis(circuit: CircuitIR, fallback: AnalysisMode = AnalysisMode.SHOW_MATRIX) -> DirectiveRecord:
    """Select the final directive, or use a fallback mode."""

    if circuit.directives:
        return circuit.directives[-1]
    return DirectiveRecord(mode=fallback, raw_line="")
