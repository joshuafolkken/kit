# Lane lifecycle — states, events and the operations outside them

- States of a lane's record (`scripts/lane/lane-state.ts`): `open` · `running` · `paused` · `human-review` · `ended`.
- The moves: one table of state × event → next state and guards, `scripts/lane/lane-transition-table.ts`.
- The allowed-transition check on every record write is derived from that table; nothing else spells a transition.
- Guards are named there; #8777 evaluates them.

## Events

| Event                                     | From                              | To             | Guards                                           | Writer                                                                        |
| ----------------------------------------- | --------------------------------- | -------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `open`                                    | `open`, `ended`                   | `open`         | —                                                | `scripts/lane/lane-open.ts`                                                   |
| `adopt`                                   | no record                         | `open`         | `no-record`                                      | `scripts/lane/lane-adopt.ts` → `record_adopted`                               |
| `launch`                                  | `open`                            | `running`      | `work-tree-present`                              | `scripts/lane/lane-dispatch.ts` (`lane:dispatch`)                             |
| `restart`                                 | `running`                         | `running`      | `work-tree-present`                              | `scripts/lane/lane-dispatch.ts` (`lane:restart`)                              |
| `pause`                                   | `open`, `running`, `paused`       | `paused`       | —                                                | `scripts/lane/lane-pause-cli.ts` (`lane:pause`)                               |
| `dependency-wait`                         | `open`, `running`                 | `paused`       | —                                                | `scripts/lane/lane-dispatch-dependency.ts` (`lane:dependency-wait`)           |
| `resume`                                  | `paused`                          | `running`      | `paused-by-person`, `work-tree-present`          | `scripts/lane/lane-pause-cli.ts` (`lane:resume`)                              |
| `dependency-resume`                       | `paused`                          | `running`      | `paused-by-dependency-wait`, `work-tree-present` | `scripts/lane/lane-dispatch-dependency.ts` (`lane:dispatch`)                  |
| `hand-over-open` / `-running` / `-review` | that state                        | the same state | `owner-run-ended`                                | `scripts/backlog/backlog-drive-carried.ts` → `record_transfer`                |
| `human-review`                            | `open`, `running`, `human-review` | `human-review` | —                                                | `scripts/run/hold/run-hold-cli.ts` (`run:hold --human-review-stop`)           |
| `merge`                                   | `open`, `running`                 | `human-review` | `stop-marker-missing`                            | `scripts/run/merge/run-merge-human-review.ts` (`run:merge`)                   |
| `review-resume`                           | `human-review`                    | `running`      | `work-tree-present`                              | `scripts/run/run-halfrun-resume.ts` (`run:entry`, `run:hold --halfrun-round`) |
| `withdraw`                                | every state but `ended`           | `ended`        | —                                                | `scripts/lane/lane-withdraw.ts` (`lane:withdraw`)                             |
| `close`                                   | every state                       | `ended`        | —                                                | `scripts/lane/lane-close.ts` (`lane:close`)                                   |

`adopt` and the hand-over do not yet go through the transition check: `record_adopted` and `record_transfer` write the record directly. Routing them through the table is #8777's.

## Operations

| Operation | Where it is kept                           | Event or path                                                                                                                      |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| pause     | lane record                                | `pause`, or `dependency-wait` for a dependency wait                                                                                |
| resume    | lane record                                | `resume`, or `dependency-resume`                                                                                                   |
| adopt     | lane record                                | `adopt`; a stopped lane a later run takes over is `hand-over-*`                                                                    |
| park      | GitHub label                               | `PARKED_LABELS` (`scripts/issue/issue-labels.ts`), read live by `scripts/lane/lane-parked.ts`                                      |
| withdraw  | lane record                                | `withdraw`                                                                                                                         |
| fold      | lane record, through withdraw              | `withdraw`; the blocked-by edits are on the Issues (`scripts/lane/lane-fold.ts`)                                                   |
| retry     | none                                       | no lane command; `lane:close` retries its own removal (`scripts/lane/lane-close.ts` → `retry_closes`)                              |
| hold      | stamp file                                 | `josh-run-hold-*` (`scripts/run/hold/run-hold.ts`) with the `in-progress` label; its human-review stop is the `human-review` event |
| solo      | none                                       | no lane command; only a transcript statistic (`scripts/lane/lane-transcript-stats.ts`)                                             |
| hand-off  | marker file                                | `<ledger>.hand-back` (`scripts/lane/lane-hand-back-hold.ts`)                                                                       |
| merge     | lane record, only on a missing stop marker | `merge`; the lane ends by `close`                                                                                                  |

## Concepts to merge

The table adds no concept; these fold existing ones into it.

| Concept                                                                                                | Merge into                                                                                 | Child Issue |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------- |
| Pause origin read from the `changed_by` command name (`lane:dependency-wait`)                          | A field on the record, read by the `paused-by-person` / `paused-by-dependency-wait` guards | #8768       |
| park, withdraw and fold overlap (a label, an `ended` record, a withdraw with a stash)                  | One event family on the record, the label kept as its display                              | #8775       |
| The hand-back marker file                                                                              | An event on the record instead of a sidecar file                                           | #8775       |
| `record_adopted` / `record_transfer` writing outside the check, and the unchecked branch and work tree | The table's guards, evaluated on every write                                               | #8777       |
