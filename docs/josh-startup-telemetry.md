# Backlog startup timing

Startup timing is appended to the existing lane ledger as `kind: startup`. It is stored in the
persistent JSONL under the common git directory that `lane_ledger.target()` /
`target_of(repository)` resolves. Deleting or thinning the event stream does not change this
ledger. Writes reuse the existing ownership check, O_APPEND and O_NOFOLLOW, and share the ship lap
and the scope inheritance into child processes.

Filter `kind === 'startup'` out of `lane_ledger.read_entries(path)`, and read per-phase times,
states and API/cache counts with `run_startup_store.summarize(rows)`.
`concurrent_misses(rows)` returns the misses whose fills for the same key overlapped. The first miss
can also become concurrent later, so the time spans of every record are compared. No waiting or
deduplication is added.

- `run`: the repository and the carry's start time. A resumed run keeps the same value.
- `attempt`: a UUID per new offer, launch or initialization call. Child phases and child commands
  inherit it.
- `issue`: the Issue number, when known.
- `id` / `parent`: the phase UUID and the parent phase UUID. Concurrent launches are separate
  phases.
- `phase`: initialization, candidate fetch, condition check, eligibility, defect rate, measurement,
  split judgment, lane creation, install resource wait, install run, reinstall, worker dispatch.
- `edge`: start, done, failed, waiting, or an API/cache observation.
- `elapsed_ms`: the monotonic elapsed time, recorded on the terminal edge only. A parent includes
  its children's time, so the times are not summed.
- `api`: separates REST, GraphQL, other gh calls and free endpoints at the shared gh spawn counter.
  A retry is a separate call and a paginate is one CLI spawn; neither is an HTTP page count or a
  billed count.
- `cache`: shared cache hits, misses and fills. The key stores only the slot and a hash of the
  lookup key. Memory caches that bypass the shared cache are out of scope.

A startup step that returns its failure as a value is recorded as failed, and an answer that holds
the launch until resources free up is recorded as waiting. An exception is failed too. A phase that
ends with only its start is incomplete and keeps its time undetermined. Failures, waits and
incomplete phases are never replaced with a success time or zero seconds.

Timing is best effort. A record whose run identity, storage resolution or append fails is missing,
and the original step's result or exception does not change. It does not intervene in candidate
order, trust verification, ownership checks or launch counts. Records are not used for success
judgments or launch conditions. A measured baseline and speed-ups are left to later Issues.
