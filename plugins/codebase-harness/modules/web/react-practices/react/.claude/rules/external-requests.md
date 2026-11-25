---
paths:
  - "src/**"
---

# External requests

Every call to a service outside the app (an API, an auth provider) keeps these rules.

## One function per service

- Every call to a service goes through one shared function that sets the time limit, retries and error handling below. A call never sets them on its own.
- Code that sends many requests to one service at once (one per item of a list) caps how many run together, below the point where the service starts refusing them.

## Time limits

- Every request has a time limit (`signal: AbortSignal.timeout(ms)`), so a slow service cannot hold a screen forever. A request a screen waits for gets a few seconds at most.
- A request the user no longer needs is cancelled: pass on the `signal` the data library gives the fetch function, or abort an `AbortController` when the input changes or the component goes away.

## Retries

- Retry only failures that can pass on their own: 429, 502, 503, 504 and network errors. Never retry another 4xx: the same request fails the same way.
- Two or three tries at most, each waiting longer than the last (exponential backoff) plus a random part (jitter), so callers do not all come back at the same moment.
- A `Retry-After` header sets the wait. When it is longer than the user can wait, fail at once.
- Retry a write only when doing it twice changes nothing: the service treats it as idempotent (`PUT`, `DELETE`) or takes an idempotency key. Otherwise fail and let the user try again.
- Retry in one place only, the shared function or the data library, never both: the tries multiply.

## Failures

- A failed request shows an error with a way to try again, never an empty screen or a spinner that never stops. A failure in one part of a screen leaves the rest working (an error boundary around that part).

## Writes and caches

- A write clears every client cache entry that holds what it changed (`queryClient.invalidateQueries`, say) when it succeeds, so the user sees their own change.
- A control that writes is disabled while its write runs, so a double click does not send it twice.
