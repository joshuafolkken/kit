# 引き金つき配送 — 規則を「効く瞬間」に届ける（joshuafolkken/kit#1524）

規則の届け方は 2 つある。**常駐**（`CLAUDE.md` に書き、毎ターン読み込ませる）と、**引き金つき配送**（規則が効く瞬間にフックが本文を突きつける）である。この文書は後者の単一ソースであり、配送される規則の一覧でもある。配線・判定の細部と経緯は `docs/maintainers/rule-delivery-rationale.md` にあり、ランの途中で読む必要はない。

## なぜ配送が要るのか

常駐の経路は実効上限で詰まっており、配送は該当する瞬間だけのコストで届き、拒否は読み飛ばせず、発火を単体テストで固定できる。経緯: `docs/maintainers/rule-delivery-rationale.md` →「なぜ配送が要るのか」。

## 判定基準 — 引き金を特定できるか

どの規則を配送へ移すか — 引き金を 1 件のツール呼び出しとして名指しできるか、常駐側にトリガの 1 行を残す理由、移設が削除ではないこと — の単一ソースは [`residency.md`](./residency.md) →「第 1 問」であり、ここには写さない。この文書が持つのは、移した規則の一覧である。

## 機構 — 1 本だけ、新規に作らない

配送はすべて 1 つの土台に載り、入口はイベントごとに 2 つある。`PreToolUse` の入口が `pnpm josh pretool:guard`（バッチング ／ 調査 ／ 規則の 3 ガードを 1 プロセスで合成）、Stop フックの入口が `pnpm josh stop:guard` である。**2 本目の配送経路を作るのは `CLAUDE.md` →「No clones」が禁じるクローン**である。配線・停止スイッチ・拒否の優先順位: `docs/maintainers/rule-delivery-rationale.md` →「機構」。

## 配送されている規則

各項目は**規則**（単一ソース）・**発火点**・**発火しないとき**を持つ。フックが走らないエージェントはこれを自己適用のチェックリストにする（`principles.md`）。頻度を書いていない項目は 1 ラン 1 回だけ配送される — 「毎回発火する」「毎回拒否する」「たびに発火する」「停止をブロックする」（`stop:guard` は止まるたびに判定する）と書いた項目は、条件を満たすかぎり何度でも発火し、「再び発火する」と書いた項目は間隔をおいて再発火する。

- **ターン内バッチング**（`turn-batching.md`）
  - 発火点: `pnpm josh batch:guard` — 単発呼び出しのターンが 3 つ続いた次の `Bash` / `Edit` / `Read`。単発が続くかぎり、さらに 3 ターンごとに**再び発火する**（joshuafolkken/kit#2164）
  - 発火しないとき: 往復あたりの呼び出し数が下限を上回っている ＝ 規則は既に守られている
- **調査の委譲しきい値**（`delegation.md`）
  - 発火点: `pnpm josh investigation:guard` — 編集しないファイルの読み取りが 3 件目に達した `Read` / `Bash`。拒否の後も読み取りがもう一度しきい値まで積み上がれば**再び発火する**
  - 発火しないとき: 読み取りがしきい値未満 ＝ 委譲する対象がまだ無い
- **バックログ WIP 上限**（`wip-cap.md`）
  - 発火点: `pnpm josh rule:guard` — Issue を起票する `Bash`（`pnpm josh issue:file`）
  - 発火しないとき: Issue が起票されていない ＝ 上限に触れる行為が無い
- **直接起票の禁止**（`docs/josh-commands-backlog.md` → `josh issue:file`、joshuafolkken/kit#2808）
  - 発火点: `pnpm josh rule:guard` — `josh issue:file` を通さずに Issue を作成する `Bash`（`gh issue create`、または `…/issues` への `title` 付き POST）。拒否文は `pnpm josh issue:file` の書式を渡す。**毎回発火する**
  - 発火しないとき: `pnpm josh issue:file` で起票している ＝ 重複探し・本文の検査・`epic:bundle` までの全段がそろっている
- **1 ラン 10 件の起票上限**（`.claude/skills/workflow-commands/prerequisite.md`、`observation-filing.md`）
  - 発火点: `pnpm josh rule:guard` — 拒否されていない起票が既に 10 件あるランの 11 件目の `pnpm josh issue:file`。失敗した呼び出しは数えない。**毎回発火する**
  - 発火しないとき: 拒否されていない起票が 10 件未満 ＝ 上限に触れていない
- **Issue コメントの読み取り**（`issue-comments.md`）
  - 発火点: `pnpm josh rule:guard` — Issue 本文だけを読む `Bash`（`gh issue view <N>`、または `…/issues/<N>` で終わる GET）。コメント込みで読み直すまで毎回拒否する
  - 発火しないとき: Issue を読んでいない、または最初から `--comments` ／ `--json comments` ／ `…/comments` で読んでいる
- **本文をシェルに載せない**（`shell-body.md`）
  - 発火点: `pnpm josh rule:guard` — 二重引用符の本文値（`-f body="…"` ／ `-f "body=…"` ／ `--body "…"` ／ `--notify-message "…"`）にバッククォートか `$` を含む `Bash`
  - 発火しないとき: 本文がシェルに評価されない ＝ 規則は既に守られている（経緯: `docs/maintainers/rule-delivery-rationale.md` →「本文のシェル評価を同じ機構の 1 行で覆った経緯」）
- **@path をリテラル投稿する誤射**（`shell-body.md`、joshuafolkken/kit#2304）
  - 発火点: `pnpm josh rule:guard` — 生フィールド（`-f` ／ `--raw-field`）で `body=@<path>` を渡した `Bash`。**毎回発火する**
  - 発火しないとき: `-F` ／ `--field body=@`・`@` を含まない本文・`pnpm josh issue:comment` ＝ リテラルの `@path` が送出されない
- **検証コマンドのパイプ**（`output-bounds.md`）
  - 発火点: `pnpm josh rule:guard` — 合否を意味する josh のチェック（`gate` ／ `check` ／ `lint*` ／ `cspell*` ／ `test*` ／ `eval` ／ `overrides` ／ `ranges`）がパイプの手前に立った `Bash`
  - 発火しないとき: 検証の終了コードが握りつぶされていない ＝ 失敗が失敗として伝わる
- **早すぎる進捗報告**（`.claude/skills/workflow-commands/progress-watcher.md` → 「Progress while the run is quiet」）
  - 発火点: `pnpm josh rule:guard` — 待つことだけが目的の `Bash`（`sleep` だけ、または `echo` ／ `:` ／ `date` を並べただけ）を、タイマーが生きている回か報告が間隔前に着地する回に出したとき。**毎回発火する**
  - 発火しないとき: 待機タイマーを自前で張っていない ＝ 時計は `run:progress` が 1 本だけ持っている
- **run 末尾の空転**（`background-commands.md`）
  - 発火点: `pnpm josh rule:guard` — `pnpm josh git -y`（別名 `josh g`、`--yes` も同じ）を**前景**で出した `Bash`。**毎回発火する**
  - 発火しないとき: 背景で発行している ＝ 完了通知が run を再開させ、push とマージのあいだが空かない
- **gate 手前の cut**（`.claude/skills/workflow-commands/pre-gate-cut.md`）
  - 発火点: `pnpm josh rule:guard` — レーンの作業ツリーで、目印 `JOSH_LANE_CHILD` がその Issue を指し、cut 記録が無いまま `pnpm josh gate`（別名 `josh ga`）を走らせる `Bash`
  - 発火しないとき: レーン以外の checkout に居る、目印が無い（レーン内の人）、または既に cut 済み ＝ 規則が守られている状態
- **実装フェーズの cut**（`.claude/skills/workflow-commands/pre-gate-cut.md` → 「It is a guard, fired at the edit that crosses the threshold」、joshuafolkken/kit#2310）
  - 発火点: `pnpm josh rule:guard` — 派遣されたレーンの子が cut 前に、直近文脈のコストが `pnpm josh cost --cut` のしきい値を超えた状態で出す `Edit` ／ `Write`。拒否文は `pnpm josh run:cut --impl <N> --handoff <path>` を渡す。しきい値を跨ぐたびに発火する
  - 発火しないとき: レーンの子でない、非編集ツール、既に cut 済み、またはコストがしきい値未満 ＝ 打ち切りが要らない状態
- **レーンの子の保留**（`.claude/skills/workflow-commands/pre-gate-cut.md`）
  - 発火点: `pnpm josh rule:guard` — 派遣されたレーンの子が停止通知 `pnpm josh notify --task-type confirmation` を出した `Bash`
  - 発火しないとき: レーンの子でない（レーン外・目印なし・レーン内の人）、または停止通知でない ＝ 保留を記録すべき停止が無い
- **レーンの子の対話質問**（`.claude/skills/workflow-commands/pre-gate-cut.md` → 「The interactive ask is refused one call earlier」）
  - 発火点: `pnpm josh rule:guard` — 派遣されたレーンの子の `AskUserQuestion`。park 手順を返す。**毎回発火する**
  - 発火しないとき: レーンの子でない、または対話ツールでない ＝ 握りつぶされる質問が無い
- **テストの宣言**（`CLAUDE.md` → Code Change Rules）
  - 発火点: `pnpm josh rule:guard` — `pnpm josh git -y`（別名 `josh g`）を出した瞬間に `pnpm josh test:declared` が `required` と答える `Bash`
  - 発火しないとき: `exempt`（非ランタイムのみ）または `satisfied`（テストを含む）＝ テストが要らない、または伴っている
- **force push / ブランチ削除**（`operating-rules.md`、joshuafolkken/kit#2120）
  - 発火点: `pnpm josh rule:guard` — 綴りによらず force（`--force` ／ `-f` ／ `-uf` 等）・削除（`--delete` ／ `-d` ／ `-D` ／ `:branch`）と判定した `git push` / `git branch` の `Bash`。**毎回発火する**
  - 発火しないとき: 通常の `git push` / `git branch` ＝ 破壊的操作が無い
- **認可外の作業ツリー変更**（`operating-rules.md`、joshuafolkken/kit#2120）
  - 発火点: `pnpm josh rule:guard` — `git checkout -- <path>` ／ `git restore <path>` ／ 強制 `git clean -f` ／ 認可外の `git stash`（bare・メッセージ無し push・位置指定 pop 等）の `Bash`。**毎回発火する**
  - 発火しないとき: `git stash push -m` ・`git stash list` ・`pnpm josh git` ・`pnpm josh stash:pop` ＝ 認可された退避
- **index の書き換え**（`operating-rules.md`、joshuafolkken/kit#2983）
  - 発火点: `pnpm josh rule:guard` — 綴りによらず `git add` ／ `commit` ／ `reset` ／ `rm` ／ `mv` ／ `restore --staged` と判定した `Bash`。**毎回発火する**
  - 発火しないとき: `pnpm josh git` ＝ 承認済みのコミットフロー
- **破壊的コマンド**（`operating-rules.md`、joshuafolkken/kit#2983）
  - 発火点: `pnpm josh rule:guard` — `rm -rf`（綴りによらず）・`gh repo delete` ／ `archive`・`gh pr close`・`gh api -X DELETE` の `Bash`。**毎回発火する**
  - 発火しないとき: `gh issue close`・Issue ラベルの削除 ＝ ワークフロー自身の手順
- **PR の直接作成**（`CLAUDE.md` → Git Rules、joshuafolkken/kit#3183）
  - 発火点: `pnpm josh rule:guard` — `gh pr create`・`repos/<o>/<r>/pulls` への `gh api` 書き込みの `Bash`。`pnpm josh pr` を案内する。**毎回発火する**
  - 発火しないとき: `pnpm josh pr`・PR の閲覧 ＝ `closes #N` を生成する経路
- **保護ファイル**（`operating-rules.md`、joshuafolkken/kit#2983）
  - 発火点: `pnpm josh rule:guard` — `.env` の `Read`、kit 以外のリポジトリでの `.claude/settings.json` の `Edit` ／ `Write`。**毎回発火する**
  - 発火しないとき: kit 自身とユーザー単位の `~/.claude/settings.json` の編集
- **ファイル本文をシェルに載せない**（`file-edits.md`、joshuafolkken/kit#2120）
  - 発火点: `pnpm josh rule:guard` — 既存ファイルへのヒアドキュメント書き込み・書き込みを伴う `node -e` ／ インタプリタ heredoc・`perl -0pi -e` の `Bash`。**毎回発火する**
  - 発火しないとき: 新規ファイル作成・読み取り専用のヒアドキュメント・短い `sed -i` ＝ 本文を丸ごと運んでいない
- **停止時の通知**（`CLAUDE.md` →「Mid-workflow stop notification」、joshuafolkken/kit#2121）
  - 発火点: `pnpm josh stop:guard` — 作業ツリーを押さえたまま、その turn に `confirmation` 通知を出さずに止まる。**停止をブロックする**
  - 発火しないとき: 押さえが無い、`confirmation` 通知が末尾にある、または pre-gate cut を取った回 ＝ 人待ちの停止ではない
- **hold の解放**（`.claude/skills/workflow-commands/working-tree-hold.md`、joshuafolkken/kit#2121）
  - 発火点: `pnpm josh stop:guard` — ツリーが綺麗なのに `run:hold` 記録が残ったまま止まる。**停止をブロックする**
  - 発火しないとき: ツリーが汚れている（`halfrun` の commit 前停止・`needs-human-review` 停止）、または解放済み ＝ 次のランが踏まない
- **Issue 引用の書式**（`prompts/collaboration-workflow/issue-citation.md`、joshuafolkken/kit#2121・joshuafolkken/kit#2247）
  - 発火点: `pnpm josh stop:guard` — 最後の返信の地の文に裸の `#N` を含む。**停止をブロックする**。引用を直して返信を出し直させる
  - 発火しないとき: リンク形式・コード／引用行の中・`PR` 直後の `#N`・GitHub 向け成果物 ＝ 差し戻す裸の番号が無い
- **起票の申し出**（`.claude/skills/workflow-commands/observation-filing.md`、joshuafolkken/kit#2422）
  - 発火点: `pnpm josh stop:guard` — 最後の返信の地の文が起票を申し出る（「起票してよければ」等）のに、起票していない。**停止をブロックする**
  - 発火しないとき: 起票済み、フェンス／引用行の中、第三者の `owner/repo` を名指す、または owner 不明 ＝ 保留された Tier A 起票が無い
- **規則本文を散文に書き足す前の第 0 問・順序の問い**（`residency.md`、joshuafolkken/kit#2272・joshuafolkken/kit#2324）
  - 発火点: `pnpm josh rule:guard` — `CLAUDE.md` ／ `prompts/**/*.md` ／ `.claude/skills/**/*.md` への `Edit` ／ `Write` で、正味の追記が閾値以上のもの。`pnpm josh oracle:list` と `pnpm josh run:step` の両方を走らせるまで毎回拒否する
  - 発火しないとき: 規則ドキュメントでない、追記が閾値未満（誤字・リンク張り替え・削除）、または両コマンドを実行済み ＝ 配置の問いに答え済み
- **オラクル未参照の行為**（`decision-oracle.ts`、joshuafolkken/kit#2324）
  - 発火点: `pnpm josh rule:guard` — 発火点を宣言したオラクルが支配する `Bash`（`pkg:scout` ＝ `pnpm add`）を、そのオラクルの `pnpm josh <command>` 無しで出したとき。実行するまで毎回拒否する
  - 発火しないとき: 支配下の行為を出していない、またはそのオラクルを実行済み ＝ 規則は既に守られている

**引き金はシェルのコマンド文字列しか見えない**（node 内の REST や `gh api --input <file>` は掛からない）。だから常駐側にトリガ 1 行を残し、配送はそれを効く瞬間に補強する。

**「引き金が発火しないターンでは何も起きない」ことは仕様である。** 各項目の発火しない状態は「規則が守られている状態」と一致する。一致が取れない規則は引き金を特定できておらず、常駐に残す。**誤ったターンで発火するフックは、フックが無いより悪い。**

## 配送は 1 ラン 1 回

配送文は**ラン 1 回につき 1 度**しか出ない — 2 度目も拒否すれば、規則に従った直後の呼び出しを止めてしまう。だから**配送文には「同じ呼び出しをもう一度出せ」と明記する**。例外は 2 つで、繰り返す行為を止める項目は毎回発火し（joshuafolkken/kit#1570）、前提の行為を求める項目は前提が末尾に現れるまで毎回拒否する（joshuafolkken/kit#2807）。これとは別に、バッチングと調査の 2 ガードは同じ呼び出しを二度拒否しないまま、違反が間隔分続けば再び発火する（joshuafolkken/kit#2164）— 1 回きりの注意ではない。先の 2 つの例外の配送文には「同じ呼び出しをもう一度出せ」ではなく、それぞれ「これは毎回発火する」「前提が末尾に現れるまで拒否する」と明記する — 1 回きりと読まれると、再発行すれば通ると誤解される。前提の証拠を読めないときは拒否を基本とする。経緯と意図した通過例外: `docs/maintainers/rule-delivery-rationale.md` →「配送は 1 ラン 1 回」。

## マーカーテスト

各項目を固定するスイートの一覧: `docs/maintainers/rule-delivery-rationale.md` →「マーカーテスト」。
