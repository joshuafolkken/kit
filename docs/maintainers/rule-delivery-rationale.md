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

移設は削除ではないので、joshuafolkken/kit#1477（読み込む命令文のコスト測定）の答えを待つ必要はない — あちらが門番なのは**削除**の判断である。

## 機構

配送はすべて `scripts/josh/hook-decision.ts` の `create_transcript_guard` の上に載る。バッチガード（joshuafolkken/kit#1390）と調査ガード（joshuafolkken/kit#1460）が既に共有している唯一の土台であり、ペイロードのスキーマ、`deny` の封筒、環境変数のスイッチ、`.env` の読み込み、ラン 1 回だけ発火させる記録の 5 つを持つ。2 本目の配送経路は、2 本が「配送したかどうか」で食い違いうる唯一の場所でもある。

- **列挙表**: `scripts/rules/delivered-rules.ts`。1 規則 = 1 行（`id` ／ 引き金 ／ 配送文）。
- **入口**: `scripts/hooks/pretool-guard-cli.ts`（ガードの合成は `scripts/hooks/pretool-guard.ts`）＝ `pnpm josh pretool:guard`。3 つの `PreToolUse` ガード（バッチング ／ 調査 ／ 規則）を 1 プロセスにまとめ、`.claude/settings.json` の `PreToolUse` に**単一エントリ**として `Bash|Edit|Read|Write` のマッチャで配線されている。拒否の優先順位はバッチングの理由が先、次に調査、最後に規則であり、各ガードは内部で従来どおり自分の環境変数スイッチを尊重する。
- **停止スイッチ**: `JOSH_RULE_GUARD`（規則ガードのぶん。既定で有効。`off` / `0` / `false` / `no` で無効）。バッチング・調査の各ガードも同じく自前のスイッチを持つ。

**規則ガードの列挙表に載るのは、効く瞬間がシェル呼び出しである規則に限られる**（後から加わった `Edit` ／ `Write` と `AskUserQuestion` の行を除く）。Claude Code は 1 ターンのうち 1 件だけを拒否して残りを実行するため、拒否された `Edit` は兄弟の編集だけが適用された状態を残す（joshuafolkken/kit#1390）。

### Stop フック — 2 つ目の入口、同じ土台（joshuafolkken/kit#2121）

`stop:guard`（`scripts/hooks/stop-guard.ts` ＝ `pnpm josh stop:guard`）は **`Stop` イベントの入口**である。`.claude/settings.json` の `Stop` に matcher 空の**単一エントリ**として配線され、turn の終わりごとに走る。

**土台は共有し、判定は再利用する。** スイッチ（`JOSH_STOP_GUARD`）と `.env` の読み込みは `hook-decision.ts` のものを、停止通知かどうかは `lane-park.ts` の正規表現を、押さえの有無は `run:hold` の記録読み取りを使う — **2 本目の判定機構は作らない**。起票の有無は `filing-cap.ts` の数え方を、第一者かどうかは `repo-party.ts` の比較を使う。違うのはイベントだけで、`Stop` のペイロードにはツール呼び出しが無く、4 行はいずれも `{"decision":"block","reason":…}` で返す。`Stop` イベントからモデルへ文字を届ける経路はこれ 1 本しかない（joshuafolkken/kit#2247）。

**入口が 2 つでも土台は 1 つ。**「1 本だけ、新規に作らない」が禁じるのは共有部の 2 つ目の写しであって、イベントごとの入口ではない。`stop:guard` の 4 行は引き金がシェル呼び出しではなく**ランの停止**なので、`delivered-rules.ts` の `DELIVERED_RULES`（`PreToolUse` 専用）ではなく `stop-rules.ts` に住む。どのエラーでも停止は通す（フェイルオープン）— 4 つのブロック行は自己解消し（通知を送る／押さえを解放する／起票する／引用を直して返信を出し直す）、`stop_hook_active` が無限ループの歯止めになる。

`backlogrun` の通常の親ループと次の Issue の取得は監督プロセスが扱うため、次の Issue を取得させる Stop 判定は撤去した。名前を指定したエピックを判断用の headless セッションに渡す経路では、子レーンの待機がそのセッションに残るため、待機保護を維持する。停滞と取り残しの検出は Stop イベントが起きた時だけ実行し、停止判定とは独立して報告する。

### 行ごとの配線の細部

手順文書の一覧から外した、実装上の再利用と判定の細部である。

- **直接起票の禁止** — 重複探し・本文の検査と分類ラベル・`## Origin` の確認・`epic:bundle` は `issue:file` が実行するので、それぞれを別の行で見張らない
- **1 ラン 10 件の起票上限** — `is_issue_filing` を再利用し、新しい述語は作らない。終了コードが 0 でない `issue:file` は起票に数えない
- **早すぎる進捗報告** — 待機だけの `Bash` は、全区間が `sleep`、または `sleep` に `echo` ／ `:` ／ `date` が並ぶだけのもの
- **run 末尾の空転** — `run_in_background` が付いていれば引き金に当たらない
- **実装フェーズの cut** — コストは `pnpm josh cost --cut` と同一の統計・同一のしきい値 `CONTEXT_CUT_THRESHOLD` で測り、測定不能は `!== UNDER` で安全側に発火する。しきい値を跨ぐたびに発火する（`decide`、joshuafolkken/kit#2385）。直後の同じ編集の出し直しを通すので `busy` ／ `failed` でも空回りしない
- **テストの宣言** — `run_tail` の commit 段照合を再利用し、新しい配送経路は作らない。免除は人が Step 0 で宣言するため 1 ラン 1 回だけ配送する
- **force push / ブランチ削除** — `git push` / `git branch` を argv として解析し、結合クラスタ（`-uf`）と `git -C` 前置も綴りによらず判定する
- **ファイル本文をシェルに載せない** — 既存判定は `stat` 1 回
- **停止時の通知 ／ hold の解放** — 押さえは `run:hold` 記録、綺麗さは `git status --porcelain` が空であることで読む
- **Issue 引用の書式 ／ 起票の申し出** — 対象は `last_assistant_message`。起票の有無は `filing_cap` の数え方、第三者かどうかは `repo_party.classify` で判定し、`stop_hook_active` が立っていれば黙る
- **規則本文の追記** — #2324 で stand-down を入れた。`oracle:list` と `run:step` の両方を走らせた記録が末尾にあれば通す（リマインダではなく「問いに答えたか」で通す）
- **オラクル未参照の行為** — 拒否文は登録簿（判断・コマンド・回答語彙・単一ソース）から組み立て、手書きしない。`release:scope` は理由側で、`pnpm josh followup` のマージ**後**に owe されるリリースを読むためマージを gate せず trail する（joshuafolkken/kit#2334）。発火点を名指せないオラクルは理由を宣言し、**可視化された未強制**として残る（`oracle:list` が発火点／理由を印字）

**引き金の 4 綴り。** 起票の判定は `-f` / `-F` / `--field` / `--raw-field` の 4 綴りを覆う。本文をファイルで渡す `gh api --input <file>` はタイトルが文字列に現れないため掛からず、node の中から REST で起票する経路（`pnpm josh propagate` など）も同じである。引き金つきの配送だけにすると、正規表現が知っている綴りだけが規則の適用範囲になる — 常駐の 1 行を残す理由である。

### コメント投稿は引き金ではない

WIP 上限の引き金は Issue の**作成**だけを見る。`…/issues/<N>/comments` はコメントであり、起票ではない — コメントは起票より桁違いに多く、そこで拒否するフックは「誤ったターンで発火するフック」そのものになる。`scripts/rules/delivered-rules.test.ts` がこの境界を両方向から固定している。

### Issue コメントの読み取り — 「読め」ではなく「目の前に置く」（joshuafolkken/kit#1319）

**引き金は実装の開始ではなく、本文が届いた 1 件の呼び出しである。** 「実装を始める瞬間」は 1 件のツール呼び出しとして名指しできないが、「Issue の本文がランの目に入る瞬間」は名指しできる — `gh issue view <N>` か、`…/issues/<N>` で終わる GET。この行が判定基準を通るのはそこである。

**拒否文は「コメントも読め」という要求ではなく、読み直しのコマンドそのものを渡す。** 散文の要求は joshuafolkken/kit#1344 が 3 ラン連続で「数値がまったく動かなかった」と実測した形式であり、この行がそれを避けるのは、本文だけの読み取りが**通らない**ことによる。ただし `PreToolUse` の拒否が運べるのは文字列 1 本だけなので、**フックがコメント本文を注入するわけではない** — 1 往復ぶん遅れて、ランが自分で取りに行く。

**この行は `batch:guard` と引き金が重なる唯一の行である。** `time_batch_guard.is_guarded_call` は `gh issue view` を候補として扱う（`gh issue create` は扱わない）。ただしこの行は前提を満たすまで毎回拒否するので、`is_first_delivery` の待避分岐を通らず、バッチングの拒否が出るターンでも拒否する。`delivered-rules.test.ts` がこれを固定している。

**判定はコマンド 1 件ごとに、行頭に錨を打って行う。** シェル 1 行は複数のコマンドを運ぶため、`&&` ／ `||` ／ `;` ／ 改行で区切った各区間をそれぞれ判定する（`|` は区切りに使わない — `--jq` の中に現れる方がはるかに多い）。これがないと、引用符の中に `gh issue view` を含む書き込み（`gh issue comment <N> -b "…"`）が読み取りと誤認され、逆に `gh issue view <N> && grep -c x` のように無関係な `-c` を含む行が「コメント込み」と誤認されて配送が消える。

**書き込みは読み取りではない。** `gh api` は `-f` ／ `-F` ／ `--field` ／ `--raw-field` ／ `--input` のいずれかが現れた時点で POST になり、`kickoff` はまさに `…/issues/<N>` へ PATCH してタイトルを正規化し空の本文を埋める。メソッドが明示的に `GET` でない、またはフィールド系のフラグを伴う呼び出しは対象外とする。

**`-c` は「コメント込み」と見なさない。** `gh issue view <N> -c` は正しい読み取りだが、`-c` は `wc` ／ `grep` ／ `sort` のものである方が圧倒的に多く、これを行全体で許すとパイプで終わる複合行すべてで規則が黙る。誤って 1 往復ぶん止める側に倒し、`--comments` ／ `--json` の `comments` ／ `…/comments` エンドポイントの 3 綴りだけを「コメント込み」とする。最後の 1 つが要るのは、バッチングが本文とコメントを 1 行にまとめさせるからである。

**それでもシェル文字列しか見えない。** node の中から REST で本文を読む経路は最初から掛からない。だからこそ手順本体は `issue-comments.md` に置かれており、フックはそれを補強するだけである。

## 配送は 1 ラン 1 回

記録は `hook-decision.ts` の stamp が持つ。**1 ラン 1 回が正しいのは、拒否がランの「知っていること」を変える行だけである。** コメントを読む、Issue を数える、本文をファイルに書く — いずれも一度届けば、そのランは以後それを知った状態で進む。

### 例外 — 繰り返す行為を止める行は毎回発火する（joshuafolkken/kit#1570）

止めたい対象そのものが繰り返される行為なら、1 回で終わる配送は「一度断られたあとは自由」を意味し、強制は親の自制に戻る。その自制が破れたのが #1570 である。そこで **`decide` を自前で持つ行は 1 ラン 1 回の対象から外れ、条件を満たすかぎり毎回拒否する**。

**`batch:guard` との待避分岐は、そういう行では守る対象が変わる。** 1 ラン 1 回の行では**記録**を守っていた — レースに負ければ、そのランに 1 度しかない配送を無駄打ちするからである。一方で待機タイマーを張る呼び出しは定義上「単発の `Bash`」であり、バッチングガードも候補として扱う形なので、**拒否まで待避させると、10 秒の窓とその中の再発行で規則がまるごと黙る**。したがって**拒否は無条件に行い、待避は「記録してよいか」として行へ渡す** — 他のフックが止めうる呼び出しでしてはならないのは、走らなかったタイマーを生きていると書き残すことだからである。

### 例外 — 前提を求める行は、前提が満たされるまで毎回拒否する（joshuafolkken/kit#2807）

**`already_satisfied`（前提の行為がトランスクリプト末尾にあるか）を持つ行は、1 ラン 1 回の対象から外れる。** 1 ラン 1 回のままだと、前提を飛ばしたランの再発行がそのまま通り、手順を読み飛ばしたランほどガードを素通りする。対象は `issue-fold`・`issue-comments`・`rule-body`・`oracle-consulted:*` である。従うランが詰まることはない — 前提の行為を済ませれば stand-down が先に答えて通す。記録を使い切る心配もないので、`batch:guard` との待避もしない（待避すると、10 秒の窓の中の再発行が前提を満たさないまま通る）。

**前提の証拠を読めないときは、拒否を基本とする。** 意図して通す例外は、理由をコードのコメントに残す。現在の例外は次のとおりである。

- トランスクリプト自体を読めないとき（`hook-decision.ts`）
- 初回の起票で、畳み込む相手がないとき（`issue-fold.ts`）
- 進捗の記録がないとき（`early-heartbeat.ts`）
- git の読み取りに失敗して、変更なしとして扱うとき（`delivered-rules.ts` の `test-declared` 行）

## 本文のシェル評価を同じ機構の 1 行で覆った経緯

コメント本文をシェルに載せるとバッククォートがコマンドとして実行される問題は、**この機構の追加 1 行で覆った**。起票時の見込みどおり新しい機構は要らず、`delivered-rules.ts` の `shell-body` 行と、その発火・非発火を固定するテストで足りている（実装先として書いていた joshuafolkken/kit#1542 は #1198 の重複として閉じられたため、実装は #1198 側で行った）。

**引き金は当初の見込みより狭い。** `-f body=` ／ `--body "` というフラグで引くのではなく、**二重引用符の本文値に `` ` `` か `$` が実際に含まれるとき**だけ発火する。本リポジトリのプロンプトにある作例はいずれもプレースホルダ（`-f body="<plan>"`）を渡しており無害なので、フラグで引くと**規則が既に守られているターンで拒否する**ことになり、手順文書の「誤ったターンで発火するフックはフックが無いより悪い」に反する。`!`（履歴展開）も引き金に入れていない — 非対話 zsh では発火しないことを実測した。規則本文と引き金の死角は [`shell-body.md`](../../prompts/collaboration-workflow/shell-body.md) にある。

## マーカーテスト

配送一覧の項目を固定するスイートには `scripts/rules/turn-batching-rule.test.ts` ／ `scripts/rules/shell-body-rule.test.ts` ／ `scripts/rules/piped-verification-rule.test.ts` ／ `scripts/rules/pre-gate-cut.test.ts` ／ `scripts/rules/implementation-cut-rule.test.ts` ／ `scripts/rules/implementation-cut.test.ts` ／ `scripts/rules/lane-park.test.ts` ／ `scripts/rules/lane-interactive-ask.test.ts` ／ `scripts/rules/rule-body-guard.test.ts` がある。各テストファイルが何を固定するか:

- `scripts/rules/delivered-rules.test.ts` — 各エントリが引き金で**実際に発火**し、それ以外では無言であること。散文が効かなかったのがこの機構の出発点であり、**発火しない移設は移設ではない**
- `scripts/claude/claude-settings-hooks.test.ts` — `rule:guard` が `PreToolUse` に `Bash` だけを名指しして配線され、タイムアウトを宣言し、実在する josh サブコマンドを指すこと
- `scripts/backlog/backlog-manufacturing-rule.test.ts` — WIP 上限が `wip-cap.md` に単一ソースとして存在し、配送文が数え方・拒否・2 つの免除・免除を決める 3 条件を運ぶこと
- `scripts/rules/turn-batching-rule.test.ts` — バッチングの配送文が判断基準を運び、参照先が `CLAUDE.md` ではなくこのディレクトリの `turn-batching.md` であること
- `scripts/document/document-markers.test.ts` — 早すぎる進捗報告の手順が `.claude/skills/workflow-commands/backlogrun.md` の該当節に単一ソースとして存在し、この文書が行と 1 ラン 1 回の例外を書いていること。発火・非発火と「毎回発火する」ことは `scripts/rules/early-heartbeat.test.ts` が固定する
- `scripts/rules/issue-comments-rule.test.ts` — コメント読み取りの手順が `issue-comments.md` に単一ソースとして存在し、3 つの `#N` 入口がそれを**再掲せずに指す**こと（矛盾時の規則を 3 箇所に写せばクローンになる）。フックが届かないセッションでも規則が残ることを、この対で担保する
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
- `scripts/rules/stop-rules-rule.test.ts` — 停止時 4 規則の単一ソース（`CLAUDE.md` の停止通知・`working-tree-hold.md`・`observation-filing.md`・`issue-citation.md`）と `rule-delivery.md` の列挙表掲載を固定する。発火・無言（押さえ×未通知でブロック／綺麗×押さえでブロック／汚れ・通知済みで無言／`stop_hook_active` で無言／起票の申し出×未起票でブロック・起票済み／第三者リポジトリ／owner 不明で無言／裸 `#N` でブロック・リンク形式やコードフェンス／インラインコード／引用行／PR 参照の中で無言）は `scripts/rules/stop-rules.test.ts`・`scripts/rules/filing-offer.test.ts`・`scripts/rules/issue-citation.test.ts` が、`Stop` フックの配線は `scripts/claude/claude-settings-hooks.test.ts` が固定する
