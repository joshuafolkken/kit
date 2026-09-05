## 委譲 — 機械的な工程を安価な実行単位へ回す

**この規則の単一ソースは [`.claude/skills/workflow-commands/SKILL.md`](../../.claude/skills/workflow-commands/SKILL.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロットに続く横展開 joshuafolkken/kit#1183）。

`residency.md` が定めるとおり、委譲はコマンドが始まった後にだけ効く規則なので手順本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複していたが、1 つの規則を直すのに書く箇所が増えるだけで設計上の意味がないため、指し先へ縮小した。参照文書だけにあったのは、起票背景（joshuafolkken/kit#969 — 判断を要する工程と手順を実行するだけの工程が同じ深さ・同じ単価で走っていた）、委譲してよいかを裁量で決めない理由と `josh review:level` との対比、条件が 3 つでその 2 つ目が本体であること、却下した候補（検証経路が無いもの、誤りの波及が大きいもの）が `kept deliberately` として記録され列挙にすら無い `kept by default` と区別されること、そして joshuafolkken/kit#1149 が広げたのは機構ではなく 1 行の射程であり `queue-child` のような 2 行目を足さないことである。いずれも縮小の前に手順書へ畳み込み済み。

手順書（「2b. Delegating a step to a cheaper tier」）に置かれている内容:

- 委譲してよいかは `pnpm josh delegate <工程>` が答え、裁量に委ねないこと。`--list` は列挙に加えて却下した工程とその理由も出す
- 既定は `keep`。列挙に無い工程は、分類されていないことを理由に委譲されない。見落としが**費用**として現れる向きに既定を置く
- 委譲の条件は 3 つで、本体は 2 つ目（誤りが「起きにくい」ではなく親側の検証で「捕まる」）であること
- 候補が落ちる理由は 2 つ（検証経路が無い／誤りの波及が大きい）であることと、`kept deliberately` / `kept by default` の区別
- 機構（どう委譲し失敗をどう露出させるか）と単位（何を委譲するか）を分けること。`epic-child` は 2 つ目の機構ではなく同じ列挙の 1 行であり、`queue` の 1 件も同じ 1 行で走る
- `epic-child` の検証経路は親が GitHub 上の子の状態を読むことであって、実行単位が返す要約ではないこと
- 実装前の下調べは「編集しないファイル」の読み取り数が閾値に達したところから委譲し、結論と根拠の `file:line` だけを本流へ返すこと（全文は返さない）。閾値の数値そのものは単一ソース側（`scripts/delegation/delegation-policy.ts` と手順書）にあり、ここには書かない。閾値が予測ではなく数え上げである理由とその実測根拠、使い捨ての検証スクリプトが委譲側で完結すること、`survey`（どこに現れるか／`grep` で検証）と `diagnosis`（却下のまま）との境界

工程の列挙そのものは `scripts/delegation/delegation-policy.ts` が単一ソースで、人が読める形は [`docs/josh-commands.md`](../../docs/josh-commands.md) →「`josh delegate`」にある。
