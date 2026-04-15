"""Legacy compatibility entry point for the rebuilt simulator package."""

from mna_simulation.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
