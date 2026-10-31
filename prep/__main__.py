"""Entry point: `uv run python -m prep <name> [<name> ...]` runs prep/<name>.py for each name."""

import importlib
import sys


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: python -m prep <name> [<name> ...]", file=sys.stderr)
        return 2
    for name in argv[1:]:
        module = importlib.import_module(f"prep.{name}")
        module.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
