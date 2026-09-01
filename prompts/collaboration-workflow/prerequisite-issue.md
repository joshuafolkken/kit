## 実行中に前提 Issue が判明した場合

**この規則の単一ソースは [`.claude/skills/workflow-commands/SKILL.md`](../../.claude/skills/workflow-commands/SKILL.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロットに続く横展開 joshuafolkken/kit#1185）。

`residency.md` が定めるとおり、前提 Issue の扱いはコマンドが始まった後にだけ効く規則なので手順本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複していたが、1 つの規則を直すのに書く箇所が増えるだけで設計上の意味がないため、指し先へ縮小した。参照文書だけにあったのは、起票背景（joshuafolkken/kit#891 — 実行中に見つかる「別の作業」3 種のうち前提だけが手順を持たず、両隣がどちらも停止で終わるため park が最も近い規則になっていた）、その 3 種の切り分け表、`route:tier-a` を付ける起票コマンドそのもの、`git stash push -u` の `-u` が必須である理由、Telegram ではなく Issue コメントが stash を回収する記録である理由、そして `epic:bundle` が答えられなかったときの打ち切り警告の見分け方（joshuafolkken/kit#1067）である。いずれも縮小の前に手順書へ畳み込み済みで、最後の打ち切り警告だけは共通節ではなく `epic:bundle` を呼ぶ各入口ファイル（`fullrun.md` / `halfrun.md` / `epicrun.md`）の判定表に入っている。

手順書（「2d. A prerequisite discovered mid-run — a dependency, not a park」）に置かれている内容:

- 前提は分割ではなく、実行中の Issue はそのまま 1 件の成果物であり、その前に別の成果物が要るという関係であること
- 実行中に見つかる「別の作業」は 3 種類（別パッケージ起因の欠陥／分割／前提）で、手順がそれぞれ異なること
- 前提 Issue は `route:tier-a` を付けて起票し、番号を後続手順が書くため**先に**起票すること
- `epicrun` では依存として記録して続けること。park が許されるのは依存として表現できないときだけであり、park すると `needs-decision` の解除に人が要って、無人実行のための park が人を必要にするという逆転が起きること
- `fullrun` / `halfrun` では起票と EPIC 登録まで済ませて停止すること。1 件の承認とバッチの承認は別であり、停止は残すこと
- `git stash push -u` の `-u` が省略できない理由と、stash を pop させるのが Issue コメントであること
- 自動起票の上限は全入口で 10 件であり、`kickoff` は実装に入らないため対象外であること

各入口での分岐そのものは、それぞれの入口ファイル（[`fullrun.md`](../../.claude/skills/workflow-commands/fullrun.md) / [`halfrun.md`](../../.claude/skills/workflow-commands/halfrun.md) / [`epicrun.md`](../../.claude/skills/workflow-commands/epicrun.md)）にあり、定義はいずれも上の 2d 節を指している。
