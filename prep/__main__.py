"""Entry point: `uv run python -m prep <name> [<name> ...]` runs prep/<name>.py for each name."""

import importlib
import pkgutil
import sys
from pathlib import Path

# Modules in prep/ that are libraries, not commands.
NOT_COMMANDS = {"__main__", "download"}


def commands() -> list[str]:
    found = pkgutil.iter_modules([str(Path(__file__).resolve().parent)])
    return sorted(m.name for m in found if not m.ispkg and m.name not in NOT_COMMANDS)


def usage() -> str:
    return f"usage: python -m prep <name> [<name> ...]\nknown names: {', '.join(commands())}"


def main(argv: list[str]) -> int:
    names = argv[1:]
    known = commands()
    unknown = [name for name in names if name not in known]
    if not names or unknown:
        if unknown:
            print(f"unknown name: {', '.join(unknown)}", file=sys.stderr)
        print(usage(), file=sys.stderr)
        return 2
    for name in names:
        module = importlib.import_module(f"prep.{name}")
        module.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
