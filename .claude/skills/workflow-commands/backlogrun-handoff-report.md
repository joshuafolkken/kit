# `backlogrun` — the hand-off report

The format of the report a `backlogrun` writes when it hands the rest of a batch to a new session —
read when the run stops at the hand-off (`backlogrun-progress.md` → "The hand-off"). The two-layer
structure and the label translations are `prompts/collaboration-workflow/report-format.md`.

**The hand-off is a fourth kind of stop — not a completion, a park or a failure.**
**It never uses `Cause` / `Fix` / `Result`**: an unfinished epic would read as finished.

```md
**■ 区切り**

- **終わったこと**: <このセッションでマージした子を番号で名指しする>
- **残っていること**: <残りの子を件数と番号で名指しする。park した子はその旨も>
- **止めた理由**: <なぜここで区切ったか。判断ではなくコマンドの答えを書く>
- **次に打つコマンド**: <このランを再開するコマンド。`backlogrun` なら残りだけの `backlogrun #<next> #<after> …`（指定 epic だけなら `backlogrun #<E> --only`）>

**技術詳細**

- 計測: <`pnpm josh cost` が出した値と閾値>
- 引き継ぎ: <状態は GitHub にあり、会話には何も無いこと>
```

- One sentence per line, no internal identifiers, every child named by number. **Never omit
  `Remaining`** — it is the one line that tells this report from a completion report
- Telegram uses the same format and is **sent with `--task-type confirmation`** (`completion` would
  announce an unfinished epic as done)
- **Write it only when the run stops.** While a run carries on past the threshold it writes none; the
  epic progress comment is the record
