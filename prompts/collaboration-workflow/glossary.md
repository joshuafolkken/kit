# ワークフロー用語集

各語は 1〜2 行の定義と本文へのポインタだけを持つ。手順・条件・数値はここで言い換えない（joshuafolkken/kit#3080）。

- **lane** — `backlogrun` が子 Issue を並行実行する、専用ブランチ・`.env`・ポートを持つ git worktree。マージは直列。→ `.claude/skills/workflow-commands/backlogrun-lanes.md` → "Lanes — running more than one child at a time"
- **cut** — プロセスを意図して終わらせ、新しいプロセスが作業を引き継ぐ境界（ゲート前の cut、セッション cut）。→ `.claude/skills/workflow-commands/pre-gate-cut.md` → "The pre-gate cut"、`.claude/skills/workflow-commands/backlogrun-progress.md` → "The hand-off"
- **hold** — 1 つの作業ツリーを 1 つのランが占有しているという記録。`pnpm josh run:hold` が取り、`pnpm josh run:release` が外す。→ `.claude/skills/workflow-commands/working-tree-hold.md` → "The working-tree hold"
- **park** — `backlogrun` が自分で決められない子を `needs-decision` で止め、バッチ全体は止めずに次の子へ進むこと。→ `.claude/skills/workflow-commands/backlogrun-park.md` → "park and continue"
- **point of use** — 文書を入口ではなく、従うべき操作の直前に同じターンで読むこと。→ `.claude/skills/workflow-commands/SKILL.md` → "Four documents are read at the point of use, not at the entry"
- **entry read** — コマンド起動時に読む文書の集合。`pnpm josh read:set` がその集合と費用を答える。→ `.claude/skills/workflow-commands/SKILL.md` → "Which file to read"
- **oracle** — 機械的に読める入力だけから規則の答えを計算するコマンド。一覧は `pnpm josh oracle:list`。→ `prompts/collaboration-workflow/residency.md` → "第 0 問"
- **interrupt** — WIP 上限を超えても起票できる、3 条件で決まる発見。上流起票の割り込み Issue とは別。→ `prompts/collaboration-workflow/wip-cap.md` → "割り込み起票"、`prompts/collaboration-workflow/upstream-interrupt.md` → "別パッケージ起因の問題は割り込み Issue で対応する"
- **Tier** — 判断点の 3 区分。A は可逆で自分で決める、B は拮抗していて人に聞く、C は不可逆・共有状態で明示指示が要る。→ `CLAUDE.md` → "Decision autonomy"、`prompts/collaboration-workflow/operating-rules.md` → "decision-autonomy"
- **carry** — `backlogrun` の 1 回の起動の予算と進捗を、セッション cut をまたいで引き継ぐ記録（`pnpm josh run:carry`）。→ `.claude/skills/workflow-commands/backlogrun-steps.md` → "The session cut is inside the invocation"
- **wave** — エピックの子をまとめて並行実行する組。仕組みではなく、依存宣言で表す形。→ `.claude/skills/epic-commands/execution-waves.md` → "Execution waves — parallel, then one alone, then the rest"
