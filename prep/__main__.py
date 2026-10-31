"""Entry point: `uv run python -m prep <name>` runs prep/<name>.py."""

import importlib
import sys


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m prep <name>", file=sys.stderr)
        return 2
    module = importlib.import_module(f"prep.{argv[1]}")
    module.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
