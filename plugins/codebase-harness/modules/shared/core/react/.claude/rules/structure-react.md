# Structure in React

How `structure.md` applies to a React + Vite project.

## Units and shared folders

- **Units** are pages: one folder per page, holding its components and its other code.
- **Shared components** go in `src/components/`, in topic subfolders.
- **The generic topic** is `src/components/ui/`: buttons, dialogs, carousels, skeletons.
- **Data fetching, external APIs and shared types** go in `src/lib/`, split into topic subfolders once it grows, even when one page uses them.

Before adding a component, search `src/components/` for one that already does it.

## Tests and imports

- A test sits next to its file.
- Import shared code through the project's path alias (such as `@/`); use `./` only inside the same folder.
