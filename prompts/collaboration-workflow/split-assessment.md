## 分割判定は全入口で共通（`kickoff epic` は作らない）

**この規則の単一ソースは [`.claude/skills/workflow-commands/split-assessment.md`](../../.claude/skills/workflow-commands/split-assessment.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロット）。

`residency.md` が定めるとおり、分割判定は「コマンド開始の後にだけ効く」規則なので本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複していたが、1 つの規則を直すのに書く箇所が増えるだけで設計上の意味がないため、指し先へ縮小した。

skill 側に置かれている内容:

- 判定の問い（単独でマージできる成果物が 2 つ以上あるか）
- 入口ごとの挙動、前提（prerequisite）は分割ではないこと
- 2 件以上なら常に epic（件数の閾値も順序条件も無い／入口ごとに条件を変えない）
- 昇格か新規 epic かの分岐（Tier A）
- 実行系（`fullrun` / `halfrun`）で分割を検出したら停止すること、`epicrun` は停止しないこと
- `kickoff epic` を作らない理由
- 別々に起票された Issue が後から関連と分かった場合は本範囲外で、`pnpm josh epic --promote` が扱うこと（joshuafolkken/kit#873）
