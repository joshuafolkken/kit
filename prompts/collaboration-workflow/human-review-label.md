## `needs-human-review` — 成果物を人が見るまで出荷させない

**この規則の単一ソースは [`.claude/skills/workflow-commands/SKILL.md`](../../.claude/skills/workflow-commands/SKILL.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロットに続く横展開 joshuafolkken/kit#1184）。

`residency.md` が定めるとおり、このラベルはコマンドが始まった後にだけ効く規則なので手順本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複していたが、1 つの規則を直すのに書く箇所が増えるだけで設計上の意味がないため、指し先へ縮小した。参照文書だけにあったのは、起票背景（joshuafolkken/kit#1125 — 「機械では測れない品質は人が見るまで出荷してはならない」を表す手段が無く、公開物と人が選ぶものの 2 類型がある）、既存の手段が成立しない理由（`needs-decision` の先付けは実行そのものを止め、Issue 本文の指示には強制力が無く、`auto-ok` を付けないことは EPIC の子に効かない）、採らなかった 2 案とその理由（PR まで作る案は「人が選ぶ」を満たさない／stash して次へ進む案は stash が積み上がる）、joshuafolkken/kit#1132 でラベル文字列を目で照合しない理由、`needs-decision` と取り違えると壊れる 2 点とそれを支えるコード側の 2 集合、そして再開の経路である。いずれも縮小の前に手順書へ畳み込み済み。

手順書（「2z. `needs-human-review` — the child that stops before its commit」）に置かれている内容:

- `epicrun` / `fullrun` / `queue` のどこから到達しても `halfrun` 相当へ降格すること。`auto-ok` とはちょうど逆向きの opt-out で、付けるのも外すのも人だけであること
- 何のために存在するか（公開物と人が選ぶもの）と、既存の手段がいずれも成立しない理由
- 降格したときの手順 — 実装と検証ゲートは通常どおり、E2E は `pnpm josh test:e2e` を自分で回して閉じる、コミット・push・PR・マージのいずれも行わない、作業ツリーは未コミットのまま stash もしない、`confirmation` Telegram に再開コマンドを載せて run 全体を止める
- 止まることは失敗ではなく仕様であること。「PR まで作ってマージしない」案と「stash して次の子へ」案を採らなかった理由
- 降格の判定は `pnpm josh issue:state <N>` の `human_review:` 行から読み、ラベル文字列を自分で突き合わせないこと（joshuafolkken/kit#1132）。判定は実装の前に一度だけ行うこと
- `needs-decision` との違い（開始前か終了前か、リポジトリを保持するかどうか）と、それを支える `issue-labels.ts` / `epic-busy.ts` の 2 集合
- ラベルをリポジトリごとに一度だけ作る `gh api` コマンド

各入口での分岐そのものは、それぞれの入口ファイル（[`fullrun.md`](../../.claude/skills/workflow-commands/fullrun.md) / [`halfrun.md`](../../.claude/skills/workflow-commands/halfrun.md) / [`queue.md`](../../.claude/skills/workflow-commands/queue.md) / [`epicrun.md`](../../.claude/skills/workflow-commands/epicrun.md)）にあり、定義はいずれも上の 2z 節を指している。
