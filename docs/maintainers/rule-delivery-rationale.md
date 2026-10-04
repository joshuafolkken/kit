# 引き金つき配送 — 経緯と根拠

この文書は [`prompts/collaboration-workflow/rule-delivery.md`](../../prompts/collaboration-workflow/rule-delivery.md) の裏にある、メンテナー専用の経緯と根拠である。手順の境界と機構を正当化する計測・経緯・論拠と、各マーカーテストが何を固定しているかの一覧を置く。ランの途中で読まれることはない — エージェントが従う引き金・行為・判定・境界はすべて手順文書に残っており、このファイルを変えても規則は何も変わらない。

## なぜ配送が要るのか

`CLAUDE.md` は実効上限まで残り数トークンまで詰まっていた（joshuafolkken/kit#1524 起票時点で 6 トークン ≒ 15〜18 文字）。一方で `prompts/` と `.claude/skills/` は常駐部の 15 倍を抱えており、**詰まっているのは常駐という 1 本の経路だけ**である。

そして配送は安いだけでなく**強い**。

|            | 常駐の散文       | 引き金つき配送           |
| ---------- | ---------------- | ------------------------ |
| コスト     | 毎ターン         | 該当する瞬間だけ         |
| 読まれるか | 読み飛ばされうる | **拒否は読み飛ばせない** |
| 発火の検証 | できない         | 単体テストで固定できる   |
| 総量の上限 | 実効上限で頭打ち | 実質なし                 |

**これは推測ではなく計測済みである。** joshuafolkken/kit#1344 はバッチングの指示について、散文でも実行時の注意書きでも数値がまったく動かなかったランを 3 回連続で記録した。`PreToolUse` フックにして初めて動いた。調査ガード（joshuafolkken/kit#1460）も同じ経緯である。**常駐していながら一度も発火していなかった規則が実在した**ということであり、移設で失われるものは「効いていなかった散文」だけである。

## 本文のシェル評価を同じ機構の 1 行で覆った経緯

コメント本文をシェルに載せるとバッククォートがコマンドとして実行される問題は、**この機構の追加 1 行で覆った**。起票時の見込みどおり新しい機構は要らず、`delivered-rules.ts` の `shell-body` 行と、その発火・非発火を固定するテストで足りている（実装先として書いていた joshuafolkken/kit#1542 は #1198 の重複として閉じられたため、実装は #1198 側で行った）。

**引き金は当初の見込みより狭い。** `-f body=` ／ `--body "` というフラグで引くのではなく、**二重引用符の本文値に `` ` `` か `$` が実際に含まれるとき**だけ発火する。本リポジトリのプロンプトにある作例はいずれもプレースホルダ（`-f body="<plan>"`）を渡しており無害なので、フラグで引くと**規則が既に守られているターンで拒否する**ことになり、手順文書の「誤ったターンで発火するフックはフックが無いより悪い」に反する。`!`（履歴展開）も引き金に入れていない — 非対話 zsh では発火しないことを実測した。規則本文と引き金の死角は [`shell-body.md`](../../prompts/collaboration-workflow/shell-body.md) にある。

## マーカーテスト

- `scripts/rules/delivered-rules.test.ts` — 各エントリが引き金で**実際に発火**し、それ以外では無言であること。散文が効かなかったのがこの機構の出発点であり、**発火しない移設は移設ではない**
- `scripts/claude/claude-settings-hooks.test.ts` — `rule:guard` が `PreToolUse` に `Bash` だけを名指しして配線され、タイムアウトを宣言し、実在する josh サブコマンドを指すこと
- `scripts/backlog/backlog-manufacturing-rule.test.ts` — WIP 上限が `wip-cap.md` に単一ソースとして存在し、配送文が数え方・拒否・2 つの免除・免除を決める 3 条件を運ぶこと
- `scripts/rules/turn-batching-rule.test.ts` — バッチングの配送文が判断基準を運び、参照先が `CLAUDE.md` ではなくこのディレクトリの `turn-batching.md` であること
- `scripts/document/document-markers.test.ts` — 早すぎる進捗報告の手順が `.claude/skills/workflow-commands/backlogrun.md` の該当節に単一ソースとして存在し、この文書が行と 1 ラン 1 回の例外を書いていること。発火・非発火と「毎回発火する」ことは `scripts/rules/early-heartbeat.test.ts` が固定する
- `scripts/rules/issue-comments-rule.test.ts` — コメント読み取りの手順が `SKILL.md` → §2g に単一ソースとして存在し、3 つの `#N` 入口がそれを**再掲せずに指す**こと（矛盾時の規則を 3 箇所に写せばクローンになる）。フックが届かないセッションでも規則が残ることを、この対で担保する
- `scripts/rules/shell-body-rule.test.ts` — 本文のシェル評価が `shell-body.md` に単一ソースとして存在し、配送文が被害・安全な綴り・再発行の指示を運ぶこと
- `scripts/rules/raw-field-body.test.ts` — 生フィールドの `body=@` 誤射（joshuafolkken/kit#2304）の述語と配送文の文言を固定する。実際の配送経路での発火（`-f` ／ `--raw-field body=@`）・無言（`-F` ／ `--field body=@`・`@` を含まない本文・`pnpm josh issue:comment`）と「1 コマンドを 1 行だけが主張する」ことは `scripts/rules/delivered-rules-bash.test.ts` が固定する
- `scripts/rules/piped-verification-rule.test.ts` — 検証コマンドのパイプが `output-bounds.md` に単一ソースとして存在し、配送文が仕組み・逃げ道・境界の 3 つを運び、読み取り専用の一覧を巻き込んでいないこと
- `scripts/rules/pre-gate-cut-rule.test.ts` — gate 手前の cut の手順が `.claude/skills/workflow-commands/pre-gate-cut.md` に単一ソースとして存在し、この文書と `docs/josh-commands.md` の双方が引き金を書いていること。発火・非発火（レーンかつ目印ありかつ未 cut でのみ拒否し、目印の無い人・レーン外・cut 済みでは無言）は `scripts/rules/pre-gate-cut.test.ts` が固定する
- `scripts/rules/implementation-cut-rule.test.ts` — 実装フェーズの cut の手順が `.claude/skills/workflow-commands/pre-gate-cut.md` →「It is a guard, fired at the edit that crosses the threshold」に単一ソースとして存在し、配送文がその節・命令・再武装の契約（再開で記録を消して両ガードを再武装させること、joshuafolkken/kit#2310）を運ぶこと。発火・非発火（レーンの子かつ目印ありかつ未 cut かつしきい値超過の `Edit` ／ `Write` でのみ拒否し、レーン外・目印なし・非編集・cut 済み・しきい値未満では無言）は `scripts/rules/implementation-cut.test.ts` が固定する
- `scripts/rules/delivered-rules-filing.test.ts` — 直接起票（`gh issue create`、`…/issues` への `title` 付き POST）が毎回拒否されて `pnpm josh issue:file` を案内され、`issue:file` の呼び出し自体は拒否されないこと。起票上限と畳み込みの行が `issue:file` の呼び出しで発火し、失敗した `issue:file` 呼び出しを起票に数えないことも同じスイートが固定する
- `scripts/rules/filing-cap.test.ts` — 起票回数の計数（拒否された起票を数に入れないこと）を固定する。発火・非発火（10 件目まで無言・11 件目で拒否・毎回発火する）は `scripts/rules/delivered-rules.test.ts` が固定する
- `scripts/rules/lane-park-rule.test.ts` — レーンの子の保留の手順が `.claude/skills/workflow-commands/pre-gate-cut.md` に単一ソースとして存在し、配送文がその節を指すこと。発火・非発火（レーンの子かつ停止通知でのみ拒否し、レーン外・目印なし・停止通知でないときは無言）は `scripts/rules/lane-park.test.ts` が固定する
- `scripts/rules/lane-interactive-ask-rule.test.ts` — レーンの子の対話質問の手順が `.claude/skills/workflow-commands/pre-gate-cut.md` → 「The interactive ask is refused one call earlier」に単一ソースとして存在し、配送文がその節を指すこと（joshuafolkken/kit#2201）。発火・非発火（レーンの子の `AskUserQuestion` でのみ拒否し、レーン外・目印なし・対話ツールでないときは無言）と毎回発火は `scripts/rules/lane-interactive-ask.test.ts` が、終了記録からの質問・選択肢の取り出しは `scripts/agent/interactive-ask.test.ts` が固定する
- `scripts/rules/lane-switch-main.test.ts` — レーンの子の `git switch main`（joshuafolkken/kit#2313）を、失敗する前に拒否する述語（`switch_target` ／ `is_switch_away_from_lane`）と配送文の文言を固定する。手順の単一ソースは `.claude/skills/workflow-commands/backlogrun-lanes.md` ／ `backlogrun-child.md`。発火・非発火（レーンの子が自分のレーンブランチ以外へ切り替えるときのみ拒否し、自ブランチ・作成/デタッチ・レーン外・主チェックアウトでは無言）と毎回発火、「1 コマンドを 1 行だけが主張する」ことは同スイートが固定する
- `scripts/rules/git-argv.test.ts` ／ `scripts/rules/git-force.test.ts` ／ `scripts/rules/worktree-guard.test.ts` ／ `scripts/rules/file-body.test.ts` — Bash 文字列の 3 群（joshuafolkken/kit#2120）の述語と配送文の文言を固定する。実際の配送経路での発火・無言と「1 コマンドを 1 行だけが主張する」ことは `scripts/rules/delivered-rules-bash.test.ts` が固定する
- `scripts/rules/index-guard.test.ts` ／ `scripts/rules/destructive-command.test.ts` ／ `scripts/rules/protected-files.test.ts` — deny の先頭一致をすり抜ける言い換え（joshuafolkken/kit#2983）を引数・パスの解析で止める 3 行の述語を固定する。`permission-guards.ts` がこの 3 行を 1 つにまとめて配送表へ渡す
- `scripts/rules/rule-body-guard.test.ts` — 規則本文を散文に書き足す `Edit` ／ `Write`（joshuafolkken/kit#2272）の述語・配送文・列挙表掲載を固定する。発火（規則ドキュメントへの追記）と無言（誤字・リンク張り替え・削除・非規則ファイル・非 Edit/Write）、および実際の配送経路での「2 つのコマンドを実行するまで毎回拒否」はこの 1 スイートが固定する。配送文が第 0 問（`oracle:list`）と順序の問い（`run:step`）を運び、単一ソースが `residency.md` であることも同じスイートが押さえる
- `scripts/rules/stop-rules-rule.test.ts` — 停止時 4 規則の単一ソース（`CLAUDE.md` の停止通知・`SKILL.md` → §2f・`SKILL.md` → §2i・`issue-citation.md`）と `rule-delivery.md` の列挙表掲載を固定する。発火・無言（押さえ×未通知でブロック／綺麗×押さえでブロック／汚れ・通知済みで無言／`stop_hook_active` で無言／起票の申し出×未起票でブロック・起票済み／第三者リポジトリ／owner 不明で無言／裸 `#N` でブロック・リンク形式やコードフェンス／インラインコード／引用行／PR 参照の中で無言）は `scripts/rules/stop-rules.test.ts`・`scripts/rules/filing-offer.test.ts`・`scripts/rules/issue-citation.test.ts` が、`Stop` フックの配線は `scripts/claude/claude-settings-hooks.test.ts` が固定する
