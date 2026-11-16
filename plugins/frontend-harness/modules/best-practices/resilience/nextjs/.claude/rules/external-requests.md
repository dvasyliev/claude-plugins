---
paths:
  - "app/**"
  - "lib/**"
---

# External requests

Every call to a service outside the app (an API, a database over HTTP, an auth provider) keeps these rules, on the server and in the browser.

## One function per service

- Every call to a service goes through one shared function that sets the time limit, retries and error handling below. A call never sets them on its own.
- Code that sends many requests to one service at once (one per item of a list) caps how many run together, below the point where the service starts refusing them.

## Time limits

- Every request has a time limit (`signal: AbortSignal.timeout(ms)`), so a slow service cannot hold a page or a route forever. A request a page waits for gets a few seconds at most.
- In the browser, a request the user no longer needs is cancelled: pass on the `signal` the data library gives the fetch function, or abort an `AbortController` when the input changes or the component goes away.

## Retries

- Retry only failures that can pass on their own: 429, 502, 503, 504 and network errors. Never retry another 4xx: the same request fails the same way.
- Two or three tries at most, each waiting longer than the last (exponential backoff) plus a random part (jitter), so callers do not all come back at the same moment.
- A `Retry-After` header sets the wait. When it is longer than the caller can wait, fail at once.
- Retry a write only when doing it twice changes nothing: the service treats it as idempotent (`PUT`, `DELETE`) or takes an idempotency key. Otherwise fail and let the user try again.
- Retry in one place only, the shared function or the data library, never both: the tries multiply.

## Failures

- A failed request shows an error with a way to try again, never an empty page or a spinner that never stops. A failure in one part of a page leaves the rest working (`error.tsx`, or an error boundary around that part).
- Log every failure on the server with the service, the status and how long it took.

## Writes and caches

- A write clears every cache that holds what it changed before the user sees its result. Tag cached reads by what they hold (`cacheTag`, or `next: { tags }` on `fetch`) so a write can name them.
- In a server action, clear with `updateTag(tag)`: the next read waits for fresh data, so the user sees their own change. In a route handler, use `revalidateTag(tag, { expire: 0 })` when the caller reads the change next, `revalidateTag(tag, "max")` when old data may show a little longer.
- A write made from the browser also clears the client cache entries it changed (`queryClient.invalidateQueries`, say) when it succeeds.
- A control that writes is disabled while its write runs, so a double click does not send it twice.
