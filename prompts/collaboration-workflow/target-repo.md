## `owner/repo#` — 実行対象のリポジトリを入口で指定する

**この規則の単一ソースは [`.claude/skills/workflow-commands/SKILL.md`](../../.claude/skills/workflow-commands/SKILL.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロットに続く横展開 joshuafolkken/kit#1182）。

`residency.md` が定めるとおり、`owner/repo#` の前置きはコマンド開始の後にだけ効く規則なので手順本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複していたが、1 つの規則を直すのに書く箇所が増えるだけで設計上の意味がないため、指し先へ縮小した。参照文書だけにあったのは、起票背景（joshuafolkken/kit#904 — 入口が対象リポジトリを受け取れず、起票先が常にセッションのリポジトリになっていた）、`epicrun joshuafolkken/kit#858` という先例が既にあり入口だけがそこから漏れていたこと、joshuafolkken/kit#865 が分割判定に対して行った是正との対比、裸の `#N` を禁じる既存規則との違い、`repo_map_logic.is_same_owner` と同じ関門であること、`pnpm josh doctor` の地図が joshuafolkken/kit#869 由来であること、そして本節を常駐させない理由である。いずれも縮小の前に手順書へ畳み込み済み。

手順書（「2c. The `owner/repo#` prefix — which repository the run acts on」）に置かれている内容:

- 前置きの書式一覧（`#N` が入る位置に置くだけで、新しいキーワードは増えない）と、定義を 1 か所に置く理由
- 短縮名は**セッションのリポジトリの owner を前置して**展開し、発見マップは引かないこと／short name が third-party に解決される経路が構造上存在しないこと／存在しない名前を近い名前に読み替えないこと
- 別 owner を明示したら third-party であり、`confirmation` の Telegram を送って止まる（Tier C）こと。判定は owner の一致だけで機械的に行う
- 省略時の挙動は変わらないこと
- `kickoff` はチェックアウト不要で、**読み取りを含む**全ての `gh api` のパスに対象リポジトリを書くこと／分割パスの EPIC 作成だけが例外で、昇格の分岐には手動フォールバックが無いこと
- 実装を伴う入口（`fullrun` / `halfrun` / `queue`）はチェックアウト必須で、無い・汚れているなら止まる。勝手に clone しない
- `epicrun` の前置きは EPIC の在り処だけを指し、上のチェックアウト規則は起動には掛からないこと
- `into <target>` とは独立した修飾であること
