---
paths:
  - "app/**"
  - "lib/**"
---

# Page loading (Next.js)

Caching APIs (`"use cache"`, `cacheLife`, `cacheTag`) follow the Next.js docs bundled in `node_modules/next/dist/docs/`.

## Show the page at once

- Await only what the top of the page needs; every other part streams in behind its own skeleton.
- Shared layouts await nothing. Data they share reaches client components as promises.
- Navigation is instant: the shell and skeletons come from the prefetch, the data streams in after.
- A list's first batch comes with the page; the next batches come from an API route.

## Cache

- Set each cache lifetime by how often that data changes: short for data that changes outside the app, long for data that barely changes. Cache an expensive aggregate as a whole, not only its parts.
- After a write, expire the cache tag of what changed instead of shortening the cache for everyone.
- A cached function that calls other cached functions takes on their tags, so expiring any of them expires it too. When it must not follow those tags, it reads that data through uncached functions.

### Serverless hosting

Only when the app runs as serverless functions, not as one long-running server. What the host provides, needs set up and bills changes often: read it in the host's current docs (through Context7 when available), never from memory.

- `"use cache"` lives in one instance's memory, so most visits find it empty. Data that is slow to get and read on many visits goes in `"use cache: remote"`, with a `cacheLife` profile of its own in `next.config` when no built-in one fits. Without a shared cache behind it, `"use cache: remote"` is in memory too: check in the host's docs whether it provides one or what to set up. One user's data goes there only when the source is slow; otherwise read it from the source.
- When the host's plan caps or bills cache reads and writes, check that the expected traffic fits before choosing where to cache.
- The remote cache starts empty after each deployment. When the first visits after one are too slow, expensive public data that barely changes can go in a store that outlives deployments; ask the user before adding one.

## Measure

Before changing a page, and again before calling the change done:

- Time it twice, signed in: `curl -w "ttfb=%{time_starttransfer} total=%{time_total} size=%{size_download}"`. The first call is cold, the second warm. In dev a code edit can empty the cache, so cold numbers there are rough.
- With the `chrome-devtools` MCP server, record a performance trace: the top of the page shows (LCP) before the slow parts, and navigation is instant.
- Count what the page sends: items rendered and HTML size. Give the numbers before and after the change in the final message.
- Targets: warm page under 1 s, HTML under ~300 KB, no media requests through an optimizing proxy.
- A page on the dev server that fails with "… is not a function" (or another missing export) for new code that type-checks means the server is stale. Do not restart a dev server you did not start: run `npm run build` and measure and check on `npx next start -p <the next port>`, then stop it.
