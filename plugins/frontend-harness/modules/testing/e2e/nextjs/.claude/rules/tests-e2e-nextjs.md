---
paths:
  - "tests/**"
---

# End-to-end tests in Next.js

- Next.js keeps the pages visited before hidden in the DOM. A test id does not skip hidden elements, so scope `getByTestId` inside `getByRole("main")` or another visible region; `getByRole` alone skips them.
- A save through a server action is a POST carrying the `next-action` header. Wait for that one (`page.waitForResponse((r) => !!r.request().headers()["next-action"])`), never for any POST: another request can answer first and the test leaves before the save is done.
