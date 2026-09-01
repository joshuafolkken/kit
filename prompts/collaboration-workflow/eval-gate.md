## `josh eval` をいつ回すか（配布物の変更を測る）

**この規則の単一ソースは [`.claude/skills/workflow-commands/eval-gate.md`](../../.claude/skills/workflow-commands/eval-gate.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロットに続く横展開 joshuafolkken/kit#1177）。

`residency.md` が定めるとおり、ルール準拠計測の手順本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複していたが、1 つの規則を直すのに書く箇所が増えるだけで設計上の意味がないため、指し先へ縮小した。「EPIC 完了時には回さない」という決定とその理由は元から手順書にもあり、参照文書だけにあったのは joshuafolkken/kit#917 / joshuafolkken/kit#860 の出典と「無人ランには計器が無い」への回答の部分である。この 2 つは手順書側へ畳み込み済み。

手順書に置かれている内容:

- 発火条件はコマンド（`pnpm josh eval:scope`）が答え、裁量に委ねないこと／測定対象パス集合の出所／空差分も `required`
- 検証ゲートのどこに入るか（`/code-review` と同時に開始し収束後に読む・`pnpm josh gate` の中には入れない）
- 収束後の再確認（`pnpm josh eval:scope --since-eval`）と、古い結果を報告しない原則
- 判定（`held` / `blocked` / `unmeasured`）とその扱い、赤の再現確認と baseline による帰属
- 消費側リポジトリでは測るのはインストール済みの kit であること
- コストの上限（全シナリオ・Issue に 1 回）、EPIC 完了時には回さない理由（joshuafolkken/kit#917 / joshuafolkken/kit#860）
