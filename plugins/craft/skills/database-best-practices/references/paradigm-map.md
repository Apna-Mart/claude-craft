# Paradigm map

Same principles, different physics. Read across the row to see what changes.

| Concern | Relational | Document | Key-value / wide-column | Search | Columnar / warehouse |
|---|---|---|---|---|---|
| Unit | row in a table | document in a collection | item in a partition | indexed document | row in a wide table |
| Relationships | declared reference, joins | embed or reference, no joins | duplicate into the access path | flattened at index time | star: facts + dimensions |
| Access paths | advisory — add an index later | mostly advisory | **binding** — the key *is* the schema | query-driven analyzers | scan-oriented, clustering keys |
| Integrity | engine-enforced | native validation, often optional | almost none — your write layer | none | none — enforced upstream |
| Duplication | the exception you justify | often the design | the design | always (it's a projection) | dimensional, versioned |
| Transaction scope | multi-row, ACID | usually per document | usually per item/partition | none | batch load |
| Source of truth? | yes | yes | yes | **never** | **never** |
| Schema change | migration under traffic | tolerant readers + versioning | rewrite the dataset | reindex | recompute the table |
