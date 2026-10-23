# Backend — case tables for APIs, jobs and queues

**Currency stamp: 2026-10-06.** Parent §20–§21 own the principles; parent §11 owns real-boundary integration tests; `backend-best-practices` owns the domain rules (idempotency, transactions, retries, authorization) that many rows below check. This file is the case checklist for a backend surface and the tools that produce each case. Tool facts were checked against each project's docs; verify against the installed versions before relying on them.

## Contents

1. The request case matrix
2. Auth and access cases
3. Dependency failure cases
4. Concurrency and time cases
5. Tools that produce each case
6. Test profiles and the production check
7. Traps

---

## 1. The request case matrix

For every field of every request (body, path, query, header), run the absence, type and size axes from `edge-cases.md` §3–§9. For every endpoint, also:

| Case | Expected behavior to pin |
|---|---|
| Malformed body (truncated JSON, wrong content type) | 400 with a stable error shape, no stack trace |
| Unknown extra fields | ignored or rejected — whichever the contract says, consistently |
| Body over the size limit | 413, rejected before parsing the whole thing |
| Paging: page 0, negative, beyond the last page, page size 0, huge page size | clamped or rejected; never a full-table scan |
| Filters and sort fields not on the allow-list | 400, never passed through to a query |
| The same request twice (client retry) | one effect — idempotency key or natural key (`backend-best-practices`) |
| Unicode and special characters in every text field | stored and returned unchanged |

Write the expected status **and** the error body for each row — "returns 4xx" hides the difference between a validation error and a crash.

## 2. Auth and access cases

- No credentials, malformed token, expired token, token for a deleted user
- Valid user, **another user's resource** (must be 403 or 404 per the contract — never the data)
- Each role against each endpoint it must not reach
- Permission removed mid-session; a token issued before a password change

These rows are the ones a missing check turns into a data leak, so each gets an integration test, not a unit test of the policy function alone.

## 3. Dependency failure cases

For each dependency (database, cache, queue, downstream HTTP service, file store):

- Slow (just under and just over your timeout), down, refusing connections, connection reset mid-response
- Returning an error (5xx, 429 with `Retry-After`), an empty body, malformed data, an unknown enum value
- Database: constraint violation, deadlock or serialization failure, read-only replica, connection pool exhausted
- Queue: duplicate delivery, out-of-order delivery, a poison message that always fails, redelivery after a crash mid-handling
- Cache: miss, stale value, cache down (the service must still answer, slower)

Expected behavior per row: what the caller sees, what is retried and how often, what is logged, and what state is left behind.

**The step after an irreversible call fails.** A charge, email or external write succeeds, then saving its result fails. This is the case that charges twice on retry, and it is testable at the endpoint: let the fake dependency succeed, make the next database write fail for that one call, then assert the response, the stored state, and that a retry does not repeat the irreversible call.

## 4. Concurrency and time cases

- Two requests changing the same record at once; two workers taking the same job; a retry racing the original
- Run the race on purpose: fire the requests in parallel in a loop and assert the invariant afterwards (one charge, one row, balance never negative)
- Time: an injected clock for month end, year end, 29 February, daylight-saving changes in scheduled jobs, tokens expiring mid-request, hosts with skewed clocks

## 5. Tools that produce each case

| Case | Tool |
|---|---|
| Your own database, cache or broker, for real | Testcontainers — throwaway containers from the test (Java, Go, .NET, Node.js, Python, Rust); see parent §11 |
| A downstream HTTP service misbehaving | WireMock: `withFault(Fault.CONNECTION_RESET_BY_PEER)` (also `EMPTY_RESPONSE`, `MALFORMED_RESPONSE_CHUNK`, `RANDOM_DATA_THEN_CLOSE`), `withFixedDelay(ms)`, `withChunkedDribbleDelay(chunks, totalMs)` |
| Latency, timeouts and resets on any TCP connection (database, cache, broker) | Toxiproxy, a proxy between the service and the dependency, with toxics `latency`, `bandwidth`, `timeout`, `slow_close`, `reset_peer`, `limit_data`, `slicer` and `packet_loss`; Testcontainers has a Toxiproxy module. To simulate "down", disable the proxy |
| Every field combination the API schema allows, including the strange ones | Schemathesis — generates requests from an OpenAPI or GraphQL schema: `schemathesis run <schema-url>` |
| Consumer and provider agreeing on the contract | Pact, consumer-driven contract tests (parent §11) |
| Value ranges and invariants in your own logic | Property-based tests: Hypothesis (Python), fast-check (JavaScript and TypeScript), Kotest's `kotest-property` (JVM) — parent §4 |

```java
stubFor(get("/rates").willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
stubFor(get("/rates").willReturn(ok().withFixedDelay(5_000)));
```

## 6. Test profiles and the production check

- Fakes and stubs are wired only in a test or local configuration profile. The production profile has none, and **no request header, query parameter or user setting can switch one on** — a "mock mode" reachable in production is a security hole.
- **Production check:** one test starts the application with the production configuration (secrets stubbed) and asserts that each adapter is the real implementation, not a fake. It fails the day someone wires a fake into the shared configuration.

## 7. Traps

- **Mocking the database to test a query** — parent §11; use a real one in a container.
- **Asserting only the status code** — a 200 with the wrong body passes (parent §8).
- **Testing retries without the duplicate** — a retry test that never checks the effect happened once proves nothing about idempotency.
- **Timeouts tested only as "down".** "Slow, then succeeds just after the timeout" is the case that double-charges.
