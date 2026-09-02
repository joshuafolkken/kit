## Step 5: PR結果確認 + 完了通知（別スクリプト）

**この規則の単一ソースは [`.claude/skills/workflow-commands/followup.md`](../../.claude/skills/workflow-commands/followup.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパイロットに続く横展開 joshuafolkken/kit#1187）。

`residency.md` が定めるとおり、CI 待ちから完了通知・マージまでの手順は `fullrun` / `queue` が始まった後にだけ効くので、手順本体は skill 側に置く。かつては同じ内容の日本語全文がここにも重複しており、さらに [`operating-rules.md`](./operating-rules.md) の「Auto-merge（default for `fullrun`）」「`completion` 通知は `pnpm josh followup` 経由のみ」の 2 節にも同じ規則が 3 度目として書かれていた。

**`operating-rules.md` には宣言文を置かなかった。** joshuafolkken/kit#1186 が決めたとおり、1 ファイルに複数の話題があるときは節を話題ファイルへ切り出してから縮小する — 指し先の検出（冒頭の宣言文）も「指し先は引用されない」規則もファイル単位で効くため、`operating-rules.md` に宣言文を置けば「指示されていない行動は取らない」「git index を勝手に変更しない」「overrides の保護」に対する正当な引用がそのまま違反として検出されるからである。

**ただし本 Issue では、切り出し用の新しい話題ファイルを作らなかった。** その 2 節が属する話題（`followup` と auto-merge）の話題ファイルは既にこのファイルとして存在し、同じ変更でそれ自体が指し先になる。だから 2 節の本文は手順書へ直接畳み込み、`operating-rules.md` には手順書を指す 1 節だけを残した。新規に作れば同一話題の指し先が 2 本並び、本文が 1 行も無いファイルを 2 つ索引へ載せることになる。**その話題の指し先が既にあるなら、切り出し先として新しい話題ファイルは要らない** — これが joshuafolkken/kit#1186 の前例に対する本 Issue の追記である。

なお auto-merge 節のうち「deny は実装であって規則ではない」の 1 文だけは手順書へ移していない。あれは deny 一覧の話題に属し、`operating-rules.md` の「指示されていない行動は取らない」が持ち続ける規則なので、**節をまたいで移しただけでファイルは変わっていない**。

参照文書だけにあったのは、`pnpm josh followup` が `pnpm josh git` の**後に走る別スクリプト**であること、Required チェックのみ待機して CodeQL などの non-required は待たないこと、Issue への完了報告は body が空なら body を編集し既にあればコメントを足すこと、Telegram は成功時のみ自動送信で CI 失敗や例外では通知が出ないこと、`failure` 通知は復旧を最終的に諦めたときに手で 1 回だけ送ること、オプション一覧（`--notify-target` は `issue` 固定で PR への完了報告はしない、`--notify-message` の 2 層書式、2 種の ignore-reason、`--issue-number`）と 4 つの実行例である。いずれも縮小の前に手順書へ畳み込み済みである。

手順書に置かれている内容:

- `pnpm josh followup` 1 回が何をどの順で行うか（Required チェック待機 → CodeRabbit 行コメント確認 → AI レビューコメント走査 → Issue への完了報告 → `completion` Telegram → マージ）
- AI レビューコメントのスキャンとブロッカー判定ヒューリスティック、**コメント一覧そのものを読めなかった場合はブロッカーと同じ扱いにする**こと（joshuafolkken/kit#973）、および CodeRabbit の行コメント一覧だけが例外であること
- kit#753 / kit#752 による CodeRabbit 非ブロッキングの暫定措置と、その revert 条件
- `josh sync` が管理・配布する設定ファイルが PR に含まれていたときの確認停止
- **auto-merge が `fullrun` の既定であり、`fullrun` と打つこと自体がマージの承認である**こと。**CI がオールグリーンでも未対応の AI レビュー指摘があるならマージしない**こと。CodeRabbit のレート制限は指摘ではないこと、指摘を反射的にバイパスしないこと、マージ経路が `followup` のものであってエージェントのものではないこと、マージ戦略・ブランチ削除・失敗時の扱い、マージ後の `pnpm josh ms`
- **`completion` 通知は `pnpm josh followup` 経由のみ**であり、`pnpm josh notify --task-type completion` を手で打たないこと（手動 CLI は PR URL を自動で埋めない）。`pnpm josh notify` は `planning` / `confirmation` / `kickoff_retry` / `failure` 専用であること
- **`pnpm josh followup` は前景で実行し、`&` でバックグラウンドにしない**こと。CI 待ち時間の予算と、ツール呼び出しの上限に当たったときの対処
- 完了時にプロジェクトのバージョンが最終行に印字され、完了 Telegram にも入ること
