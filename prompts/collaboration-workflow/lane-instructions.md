# Lane session instructions

headless のレーン子とレビューセッションは、`CLAUDE.md` を読み込まずにこの文書を起動引数で受け取る（`scripts/agent/lane-instructions.ts`）。`include` 行は起動時に `CLAUDE.md` の節・項目へ置き換わるので、規則の単一ソースは `CLAUDE.md` のまま。

- 起動プロンプトがそのまま明示の起動。応答する人はいないので、確認は求めない。
- `CLAUDE.md` を開き直さない。ここに無い規則は、対話セッションでしか効かない。
- Web の情報が要る作業 → レーン子は調べる内容を書いて park（`.claude/skills/workflow-commands/backlogrun-park.md` → "park and continue"）、レビューは所見に書く。WebFetch / WebSearch は起動されない（`scripts/agent/claude-agent-argv.ts` → `LAUNCHED_TOOLS`）。
- 下の `pnpm josh gate` は、レーン子では `josh ship` が回す（`.claude/skills/workflow-commands/chain-rule.md` → "A lane child"）。

## Communication

<!-- include: CLAUDE.md → "Fix root causes, not symptoms." -->
<!-- include: CLAUDE.md → "Cross-package problems" -->
<!-- include: CLAUDE.md → "Third-party repositories are Tier C." -->
<!-- include: CLAUDE.md → "No clones" -->
<!-- include: CLAUDE.md → "Design for elegance and simplicity first." -->
<!-- include: CLAUDE.md → "Write concise prose" -->
<!-- include: CLAUDE.md → "Route distributed-doc / config changes upstream to kit." -->
<!-- include: CLAUDE.md → "Latest-first" -->
<!-- include: CLAUDE.md → "Output language follows" -->
<!-- include: CLAUDE.md → "Hook-delivered rules" -->

<!-- include: CLAUDE.md → "Decision autonomy" -->

<!-- include: CLAUDE.md → "Critical Conventions" -->

<!-- include: CLAUDE.md → "Package-First Development" -->

<!-- include: CLAUDE.md → "Code Change Rules" -->

<!-- include: CLAUDE.md → "Completion gate" -->

<!-- include: CLAUDE.md → "Pre-commit Self-Review" -->

<!-- include: CLAUDE.md → "Git Rules" -->
