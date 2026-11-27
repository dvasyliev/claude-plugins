---
paths:
  - "**/*.{js,mjs,cjs,ts,mts,cts}"
---

# Structure in Node.js

How `structure.md` applies to a Node.js server, bot or command-line tool. Paths below start at the source folder (`src/` unless the project set another).

## Units and shared folders

- **Units** are what the app's entry file mounts: routes, commands, bot features, queue jobs. Each is a folder under one parent named after their kind (`routes/`, `commands/`, `features/`, `jobs/`), with its handlers, its logic and the scripts it runs.
- **Shared code** goes in `lib/`, one topic per file or subfolder: a service client (`lib/<service>.ts`), the data the app keeps (`lib/<topic>/`), code several units build on.
- **The generic topic** is files in `lib/` named after what they do (`lib/retry.ts`, `lib/duration.ts`), never `lib/utils.ts`.
- **Startup and settings** (the entry file, reading the environment, wiring the units) stay at the top of the source folder, outside the units and `lib/`.

## Tests and imports

- A test sits next to its file (`<name>.test.ts`).
- Inside a unit, import with `./`. Import shared code through the project's subpath imports (`"imports": { "#lib/*": "./src/lib/*" }` in `package.json`, then `#lib/<topic>.ts`) when it has them; otherwise with relative paths, which never reach into another unit's folder.
