# Structure

Where a new or moved file goes, in any stack. Each stack's `structure-<stack>.md` says what its units and shared folders are. Follow these rules for new and moved files; do not move existing files unless asked.

## Units and shared code

An app is split into **units**: the slices a user or a caller reaches (a page, a route, a command, a feature, a job). Code that is not a unit is **shared**.

Decide where a file goes by who imports it.

- **One unit uses it:** it goes in that unit's folder. This is the default; do not extract code before a second user appears.
- **Two or more units use it:** move it to a shared folder in the same change, into a topic subfolder named after what it is about, not after the units that use it.
- **Generic code with no app data** (a button, a retry wrapper, a duration format) goes in the stack's generic topic. Test: it would work unchanged in an app about something else.
- **A client of an outside service** (an API, a model provider, a file store) is shared from the start, one module per service, with the types it returns.
- **A script in another language that a unit runs** (Python, shell) sits in that unit's folder; one that several units run is shared like any code.

Before adding shared code, search the shared folders for code that already does it.

## Imports

- A unit imports shared code, never another unit. When a unit needs another unit's code, that code is shared: move it first.
- Shared code never imports a unit. Imports point one way: unit, then shared topic, then generic code.
- No import cycles, between files or between folders.
- A unit's entry file is imported only by what mounts the unit (the router, the menu, the command line), never by other code.

## Folders

- **Files that belong together** (one module and its parts, or 3+ files on one topic) go in a subfolder named after them. Do not create a folder for a single file.
- A folder is named after what its code is about (`billing/`, `auth/`), never a catch-all (`utils/`, `helpers/`, `misc/`).
- At most 3–4 levels of nested folders.
- A test moves with the file it tests.
