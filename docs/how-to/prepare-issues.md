# Prepare dependent issues

Create split children with `issue:file --route split`; this implies `--prepare`.
Use `--prepare` explicitly for another filing whose plan or dependency registration is unfinished.

The create request carries a pending body record and withholds `auto-ok`. This is preparation,
separate from the user's `--no-auto-ok` prohibition; no additional workflow label is introduced.
Ordinary single-issue filing still publishes in its create request.

1. Create prepared children and retain their issue numbers.
2. Record every child's plan with `pnpm josh issue:plan <N> --body-file .josh/tmp/plan.md --planned --no-notify`.
3. Create/promote the epic and register its native dependencies.
4. Run `pnpm josh issue:file --publish <E>` in the target checkout.

Publication freshly reads the epic and all its children. Every prepared child needs its recorded
plan and every declared dependency must exist in the native listing. Validation finishes for the
entire batch before the first publication. Each body/approval update is one atomic GitHub PATCH.

An interrupted or partially failed batch is resumed on the same issue numbers: repair the missing
step and retry publication. Already published children are skipped. Never refile the children.
`issue:spill` leaves its follow-up prepared and prints the plan/publication steps after placement.

Pending children are excluded from approval judgement, standalone and epic selection, and direct
worker spawn. Even manually applying `auto-ok` cannot make a pending child a candidate.

Every worker spawn revalidates the target's native dependencies and each blocker's state remotely:
driver/manual launch and direct dispatch, restart, cut/ship relaunch, and each OpenAI supervisor
generation. The shared dependency resolver retains cross-repository publication semantics.

Its release/manifest cache is reset at confirmation; those cross-repository checks may add their
existing publication reads beyond the native issue/listing count below.

The read bypasses the process memo and dependency summary; ETags require remote validation.
For a target with B blockers, confirmation adds 2+B issue/listing reads; full relation pages use
the existing paginated reader. There is no backlog rescan or additional polling sleep.

OpenAI startup checks once before dispatching its supervisor and again at the worker generation,
so its first startup adds two confirmations; each later generation adds one.

Blocked or unknown answers log their reason and duration and return to wait/retry without a failure
count. Launch reservations are released; a vacant newly opened lane is closed, while a working tree
with work is retained.

Resumes record the wait in the existing lane lifecycle so collection does
not mistake an unreadable dependency check for a failed worker.

The guarantees are completed preparation before publication and a fresh check after selection.
A dependency changed remotely after the final confirmation can still race the spawn: GitHub offers
no transaction covering its dependency writes and a local process launch.

The fixed-case regression probe measures confirmation reads and local launch time; it is not a
production network benchmark.
