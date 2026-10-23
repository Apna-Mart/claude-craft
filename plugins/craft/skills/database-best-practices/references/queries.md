# Writing efficient reads and writes

Principles 20–24 of `database-best-practices` (its Part 6). Mentions of Parts 2–5 and other principle numbers refer to that skill's SKILL.md.

## Contents
- 20. Skip the read entirely where you can
- 21. Read the fewest bytes
- 22. Keep the predicate on the access path
- 23. Bound it, and do it in one round trip
- 24. Write in batches, not one row at a time

### 20. Skip the read entirely where you can

The cost hierarchy starts above the query. An index makes a read cheaper; not doing the read makes it free — and it's the only lever that scales with *reader count* rather than with data size, which is why it beats query tuning on anything fronted by a popular screen.

**Bad:** every page load runs a twelve-table aggregate over all history, because the number it produces is "live".

**Good:** a derived dataset refreshed on a schedule, with the tolerated staleness written down next to it — and the page reads one row.

- **Precompute** when many readers ask the same question of slow-changing data. That's the same decision as duplicating on evidence (Part 4), so it inherits the same obligations: one owner, a rebuild path, and a known refresh cadence.
- **Cache** when the same answer is requested repeatedly and you can name a TTL you'd tolerate being stale for. Deciding *what* is worth caching is here; invalidation mechanics, stampede protection and cache-key hygiene are `backend-best-practices`.
- **Reuse within one request.** Three functions in one request each fetching the same row is N+1's quieter sibling — fetch once and pass it down.
- **Don't compute what nobody reads.** A dashboard aggregate rebuilt every minute and looked at twice a day is paying 720× for the privilege.

The precondition is honesty about freshness: **name the staleness you can tolerate before you build the copy.** If the answer is "none", you don't have a caching problem, you have a query to tune — carry on to the rest of this part.

### 21. Read the fewest bytes

The cheapest query is the one that reads least — not the one that returns least. Those differ, and the gap is where money goes.

**Bad:**
```sql
SELECT * FROM events WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 50;
```

**Good:**
```sql
SELECT id, kind, occurred_at
FROM events
WHERE user_id = $1
  AND occurred_at >= $2 AND occurred_at < $3
ORDER BY occurred_at DESC
LIMIT 50;
```

- **Project only the columns you need.** In a columnar store this is the single most expensive habit there is — `SELECT *` scans every column in the table, and selecting only what you need can cut bytes processed several-fold. **The row-store version of the same rule is TOAST:** in Postgres an oversized `text`/`jsonb`/`bytea` value is compressed and stored out-of-line, so a wide row is *not* automatically expensive to read — provided you don't select the toasted column. `SELECT *` on a table with a large `jsonb` column pays a de-TOAST cost that naming the other columns avoids entirely, and an `UPDATE` that doesn't touch the toasted column doesn't rewrite its chunks. The column list, not the row count, decides what you read.
- **`LIMIT` is not a cost control** in a warehouse: you're billed for bytes read, not bytes returned, so a limited query over an unpruned table costs the same as an unlimited one. (Clustered tables are the exception — scanning can stop early.) For exploration use the preview/head tooling, not `SELECT * … LIMIT 10`.
- **Filter on the partition or clustering key so pruning actually happens.** An unpruned scan is the most common surprise line on a warehouse bill; some engines let you *require* a partition filter so an unfiltered query errors instead of billing.
- **Aggregate at the source.** Pulling a million rows to the application to count them pays for the bytes, the network and the memory to do worse than the engine would.
- **Small queries aren't free either.** Warehouses bill a floor per referenced table per query (10 MiB in BigQuery), so thousands of tiny queries have a real cost — batch them.

### 22. Keep the predicate on the access path

An index only helps if the query is written so the engine can use it. The usual ways to accidentally opt out:

**Bad:** `WHERE date(created_at) = $1` — the column is wrapped in a function, so the index on `created_at` is unusable and you get a scan.

**Good:** `WHERE created_at >= $1 AND created_at < $1 + interval '1 day'` — a range predicate the index can serve.

- **Don't wrap the column** in a function or cast unless an index exists on exactly that expression.
- **Match the types.** Comparing an integer column to a string parameter, or joining columns of different types, forces a cast and drops the index.
- **A leading wildcard** (`LIKE '%term%'`) can't use a B-tree — that's a job for a trigram index (`pg_trgm` + GIN), full-text search, or a search engine.
- **`OR` across different columns** can't be served by one composite index. The **first** fix is a separate index per branch, which Postgres combines with a bitmap OR and MySQL sometimes handles with `index_merge` — no query rewrite needed. Only if the plan still scans, rewrite as two indexed queries combined with `UNION` (note it de-duplicates and sorts; use `UNION ALL` when the branches are disjoint).
- **In a partitioned store, a query without the partition key fans out to every partition.** That isn't a slow query, it's a distributed full scan, and it's the same mistake as an unpruned warehouse scan.

### 23. Bound it, and do it in one round trip

**Bad:**
```python
for order in orders:                                   # N+1: one query per row
    lines = db.query("SELECT * FROM order_lines WHERE order_id = ?", order.id)
```

**Good:**
```python
lines = db.query("SELECT order_id, sku, quantity FROM order_lines WHERE order_id = ANY(?)",
                 [o.id for o in orders])               # one round trip, grouped in memory
```

- **Every read gets a bound.** An unbounded result set is a latency and memory incident waiting for the row count to grow.
- **Paginate by keyset, not `OFFSET`.** `OFFSET 100000` reads and discards a hundred thousand rows; `WHERE (created_at, id) < ($1, $2) ORDER BY … LIMIT n` reads only the page.
- **`COUNT(*)` on a large dataset is a scan.** Fetch `limit + 1` and report "has more", keep a maintained counter, or accept an approximate count.
- **Kill N+1** — a query per element is the most common real performance bug in production code, and the fix is always one batched round trip.
- **A fan-out join patched with `DISTINCT`** is an expensive sort hiding a modeling bug. When you reach for `DISTINCT`, check the grain of what you joined (Part 3) before optimizing the query.

Then confirm with the engine's plan on production-like data. A prediction about a plan is a hypothesis; the plan is the evidence.

### 24. Write in batches, not one row at a time

The write path has its own N+1, and it's the one people leave in production because each individual write looks fast.

**Bad:**
```python
for row in rows:                                    # one round trip and one transaction per row
    db.execute("INSERT INTO events (user_id, kind, occurred_at) VALUES (?, ?, ?)", row)
```

**Good:**
```python
db.copy_from(rows, "events", columns=("user_id", "kind", "occurred_at"))   # one bulk load
# or, without a bulk API: one multi-row INSERT per few-thousand-row chunk, one commit per chunk
```

- **Per-row round trips pay network latency and per-statement overhead once per row**, and the gap against a batched path is routinely one to two orders of magnitude. Use the engine's bulk loader when the volume is real (`COPY`, `LOAD DATA`, bulk-insert APIs, batch write operations) and a chunked multi-row `INSERT` otherwise.
- **Batch large `UPDATE`/`DELETE` by key range, with a commit per batch.** One giant statement holds locks for its whole duration, bloats an MVCC table, and lags replicas — the batched version is slower in total and far cheaper in impact. (The lock and transaction semantics of doing so are `backend-best-practices`.)
- **In columnar and append-optimized stores, row-at-a-time insert is pathological**, not merely slow: each write becomes a part or file the engine must later merge, so you pay again in background compaction. Buffer and write in large batches.
- **Remember writes are multiplied** (Part 5): every index and hand-maintained projection is another write. For a genuinely large load, dropping non-essential indexes and rebuilding them afterwards can beat maintaining them row by row — when you can afford the window.
- **Bound the batch.** An unbounded batch is a memory spike and a long lock hold. Size it deliberately, don't maximize it.
