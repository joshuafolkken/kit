# `backlogrun` — the hand-off report

Read when the run stops at the hand-off (`backlogrun-progress.md` → "The hand-off").

**Run `pnpm josh run:report --handoff`, and relay what it prints.** It prints the hand-off report
from `run:carry` and `cost --cut`, and sends the same text as the `confirmation` Telegram, the resume
command as its `--recommended`. Nothing in it is written by hand. A send that did not go out is
named on stderr; the printed report is still the hand-off.

- **Run it only when the run stops.** While a run carries on past the threshold there is no report;
  the epic progress comment is the record
