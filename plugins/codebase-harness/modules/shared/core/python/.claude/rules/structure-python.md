---
paths:
  - "**/*.py"
---

# Structure in Python

How `structure.md` applies to a Python project. The code is one package (`src/<package>/`, the layout `uv init --package` makes, or the folder `pyproject.toml` names); paths below start at the package.

## Units and shared packages

- **Units** are subpackages, one per command, route, job or feature (`<package>/<unit>/`), with their own modules. In a project whose main stack is another language, a Python script a unit runs sits in that unit's folder, as `structure.md` says, and the rules below apply inside it.
- **Shared code** goes in subpackages next to the units, named after their topic (`<package>/storage/`, `<package>/<service>/`), or in one module per topic while it is small (`<package>/<service>.py`).
- **The generic topic** is modules named after what they do (`<package>/retry.py`), never `utils.py` or `helpers.py`.
- **The entry point** (`<package>/__main__.py`, or the command `pyproject.toml` names in `[project.scripts]`) parses the arguments and calls the units; it holds no other logic.

## Packages, tests and imports

- Every folder of the package has an `__init__.py`. It stays empty or names the package's public API (`__all__`); it holds no logic.
- Tests mirror the package under `tests/` (`tests/<unit>/test_<module>.py`) and move with their module.
- Import with absolute imports from the package (`from <package>.storage import load`); relative imports (`from .model import Item`) only inside the same subpackage.
