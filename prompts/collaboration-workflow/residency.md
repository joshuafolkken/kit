## 常駐ドキュメントと skill の分担（何を常駐に残すか）

規則を置く・移す・引退させるターンに読む（joshuafolkken/kit#2891）。規則のトリガは `CLAUDE.md` に 1 度だけ、手順と数値は導線の先に 1 度だけ書く。`CLAUDE.md` の上限は `scripts/document/resident-budget.ts` の `RESIDENT_CEILING_BYTES`（残りは `pnpm josh bytes CLAUDE.md`）。**置き場所は重要度ではなく、下の問いを順に当てて決める。** 経緯は `docs/maintainers/claude-md-history.md` と `docs/maintainers/residency-rationale.md`。

### 第 0 問（先に問う）

> **その規則の答えは、機械的に読める入力だけから計算できるか。**

できるなら、コマンドが答え、文書には導線 1 行だけを置く。既存のオラクルは `pnpm josh oracle:list`、単一ソースは `scripts/rules/decision-oracle.ts`。

### 順序の問い（第 0 問の次に問う）

> **その規則は「何を」ではなく「いつ・どの順で・どの引数で」を決めているか。**

そうであれば、規則はドライバの状態遷移に書き、文書は導線 1 行だけにする。`pnpm josh run:step <N>` が次の 1 手を計算する（`scripts/run/run-step.ts`、joshuafolkken/kit#2248）。

### 第 1 問 — 引き金を名指しできるか

> **その規則が効き始める瞬間を、1 件のツール呼び出しとして名指しできるか。**

できるなら、規則本文を常駐から出し、配送ガードの行に `scripts/rules/rule-registry.ts` の項目を添え、[`rule-delivery.md`](./rule-delivery.md) が指す `pnpm josh rule:list` の一覧に載せる（joshuafolkken/kit#1524）。**規則ごとのトリガ行は常駐に残さない** — `CLAUDE.md` には一覧への導線 1 行だけを置く。フックが走らないセッションは一覧を自己点検に使う（`principles.md` →「Claude Code 以外のエージェントでの読み替え」）。根拠は `docs/maintainers/residency-rationale.md` → "Why a delivered rule leaves no resident line"。

### 第 2 問 — skill なしのターンでも効く必要があるか

> **その規則は、skill がロードされていないターンでも効く必要があるか。**

**`CLAUDE.md` に残るのは、skill がロードされていないターンでも効く必要がある規則だけである。** 入力は「最初に効くのはコマンド開始の前か後か」の 1 点。後なら `CLAUDE.md` から導線を張り、再掲しない。

### 残すときの書き方と予算

- **常駐規則は、トリガと導線の 2 つで書く。** **判定は、導線を一度も開かないターンでも常駐の記述だけで正しく振る舞えるかである。**
- **削ることは移すことであり、削除は理由を示して初めて許される例外である。** 先に導線の先へ移し、マーカーテストも付け替える。引退の 3 条件は `docs/maintainers/residency-rationale.md` → "Trigger and pointer, and the narrow retirement route"
- 経緯（Issue 番号・なぜ・計測・却下案）は `docs/maintainers/<topic>-rationale.md` に置く。Issue 番号引用の件数は `scripts/document/issue-citation-budget.ts` のラチェットに従う — 減らしたら記録も下げる（`docs/maintainers/residency-rationale.md` → "The issue-citation ratchet"）
- 引用は本文があるファイルを直接指す（`docs/maintainers/residency-rationale.md` → "A pointer-only topic file is never cited"）
- 予算が詰まったら回収で解く。**引き上げは Tier C として扱う** — `RESIDENT_CEILING_BYTES`・`RESIDENT_HEADROOM_BYTES`・`RE_INLINE_GUARD_HEADROOM_BYTES` の緩和は、`docs/maintainers/residency-rationale.md` → "When the ceiling may be raised" の 3 条件を示し、ユーザーの明示指示を得てから行う

常駐に残る規則と配送へ移した規則の一覧は `docs/maintainers/residency-rationale.md` → "The resident-rule list"。そのほかの経緯: `docs/maintainers/residency-rationale.md` → "The reduction freeze and its retraction"、`docs/maintainers/residency-rationale.md` → "Measurement decides what leaves"、`docs/maintainers/residency-rationale.md` → "The `rule:value` readings"、`docs/maintainers/residency-rationale.md` → "Why the delivered list carries no count"、`docs/maintainers/residency-rationale.md` → "Why the workflow index is split by topic"、`docs/maintainers/residency-rationale.md` → "One list, not two"、`docs/maintainers/residency-rationale.md` → "The resident budget"。
