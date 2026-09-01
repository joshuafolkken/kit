## `into <target>` — 作った Issue をその場で EPIC へ入れる

**この規則の単一ソースは [`.claude/skills/workflow-commands/SKILL.md`](../../.claude/skills/workflow-commands/SKILL.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロットに続く横展開 joshuafolkken/kit#1181）。

`residency.md` が定めるとおり、`into <target>` はコマンド開始の後にだけ効く規則なので手順本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複していたが、1 つの規則を直すのに書く箇所が増えるだけで設計上の意味がないため、指し先へ縮小した。参照文書だけにあったのは、起票背景（joshuafolkken/kit#985 で手打ちしていた 3 行）、`into` という綴りを選んだ理由、位置の判断基準、コマンドが勝手に昇格しない理由、`epic:bundle` との違いである。いずれも縮小の前に手順書へ畳み込み済み。

手順書（「2a. The `into <target>` suffix — where the new Issue lands」）に置かれている内容:

- 接尾辞の書式一覧と、`into` という綴りを選んだ理由
- 入るのは「そのランが作った最上位の成果物」1 つだけであること
- 入れるのは作成直後・実装の前であること
- 挿入は必ず `pnpm josh epic --add` を通し、本文を手で編集しないこと
- 位置の判断基準と、その根拠を EPIC 本文か Issue コメントに残すこと
- 指定先が EPIC でないときは断り、昇格を勝手に行わないこと（対処を 2 つとも名指しする）
- 別リポジトリの EPIC は `owner/repo#N` と書き、そのチェックアウトで実行すること
- 接尾辞が無いときの挙動は変わらないこと、`epic:bundle` との違い
