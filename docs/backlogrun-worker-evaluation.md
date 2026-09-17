# Evaluating the backlogrun worker profile

Use completed ordinary-task transcripts from before a worker default changes as the frozen baseline.
Do not replay old tasks, add a comparison review, or spend AI calls only to build the comparison.
Ordinary Claude Code work uses the balanced default; difficult Claude Code work may explicitly set
`JOSH_WORKER_MODEL=opus JOSH_WORKER_EFFORT=high`. Dispatch never promotes itself or adds a
lightweight/Haiku role, and scheduler/reviewer gates remain `opus/high`.

For each baseline or canary Issue, keep one row with:

- Issue number, worker model, and sample group (`baseline` or `canary`).
- Worker output tokens, converted dollar cost, and elapsed time from every lane session for the Issue.
  Retain the JSON from `pnpm josh time --json --path <checkout>` with the Issue number. Select all
  `.sessions[] | select(.role == "lane" and .issue == <N>)` rows and sum each of `output_tokens`,
  `cost_usd`, and `elapsed_ms`; a context cut or resume can create more than one matching row. If no
  row matches, or any matching row has `is_measured == false`, record all three measurements as
  missing instead of summing the measured rows or recording zero. `is_readable` distinguishes an
  unreadable transcript from one that was readable but produced no usage records.
- Gate reruns, counted from completed `pnpm josh gate` invocations after the initial gate.
- Review High/Medium counts and their recorded dispositions.
- Parked or abnormal termination from Issue labels/comments and the `pnpm josh time` run-state block.

Record unreadable or unmeasured data as missing, never as zero. Treat the first 5 ordinary tasks after
the change as a provisional canary. Make the main decision after 10–15 ordinary tasks, comparing
medians for tokens, cost, and elapsed time and rates for gate reruns, High/Medium findings, parks, and
abnormal endings against the frozen baseline. Keep explicit Opus overrides in their own group so
high-difficulty work does not distort the default-worker sample.
