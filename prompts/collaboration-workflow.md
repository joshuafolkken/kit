# Issue-Driven Collaboration Workflow

<!-- cspell:words coderabbit -->

このドキュメントは、Claude/Cursor/Gemini を含む複数の AI ツールで共通利用するための運用フローです。

## Overview

1. Issue を作成する
2. Issue を元に実装提案を作る
3. 計画コメントを Issue に残して Telegram 通知を送る
4. 実装を進める
5. 実装完了後に Issue へ完了コメントを投稿する

### フェーズ分離

ワークフローは 2 つのフェーズに分けて実行できる。

- **Planning phase（`kickoff`）**: Step 1〜3 — Issue 作成・計画投稿・Telegram 通知で止まる。実装前にレビューや承認を挟みたい場合に使う。
- **Execution phase（`fullrun #N`）**: Step 4〜5 — 既存 Issue の計画に基づいて実装・PR 作成・完了通知を行う。

一括実行する場合は `fullrun new` で Step 1〜5 を通しで実行する。

### 手順の置き場所（常時ロードとオンデマンドの分離）

`kickoff` / `fullrun` / `halfrun` / `queue` の**操作手順**は、常時ロードされる `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` からは外され、`.claude/skills/workflow-commands/` に置かれている（joshuafolkken/kit#854）。3 文書に残るのはキーワードとスキルへの導線、およびスキルが読み込まれていない状態でも効く必要のある禁止規範（明示起動の必須ルール）だけである。依存更新後の overrides / `devEngines` 検証手順も同様に `.claude/skills/dependency-update/` へ移した。

このドキュメントは引き続き**正典の詳細版**であり、スキルは操作手順である。両者は一致していなければならないので、片方だけを更新してはならない。

### 出力の言語（`JOSH_SESSION_LANG`）

ワークフローの出力言語は、環境変数 `JOSH_SESSION_LANG`（例: `ja` / `en`）で決まる。対象は「開発者との対話」と「成果物の散文」の**両方**であり、変数が未設定のときのフォールバックだけが異なる。

- **対話は `JOSH_SESSION_LANG` に従う**: セッション中の説明・質問、および `halfrun` などで提示する **`AskUserQuestion` の選択肢ラベル・説明**。未設定の場合は、ユーザーが書いている言語に合わせる。
- **成果物の散文も `JOSH_SESSION_LANG` に従う**: Issue 本文、Issue／PR コメント（Step 3 の計画コメント、`pnpm josh followup` が自動投稿する完了コメントを含む）、Telegram 通知の本文（`--body` / `--notify-message`）。**未設定の場合は `ja` を既定とする。** 対話と違い、成果物にはその場で言語を推測できる相手がいない — セッションが終わったあとに読まれるものなので、推測ではなく決め打ちの既定値が要る。
- **設定に関わらず英語で固定するもの**（3 つ）:
  1. **Issue／PR タイトル**: Step 1 のタイトル正規化ルールは変更しない。Issue 一覧の見通しを保ち、`pnpm josh git` が作るブランチ名を ASCII に保つため。
  2. **コード内コメント、テストタイトル（`describe` / `it` / `expect`）、コミットメッセージ**: リポジトリのコード規約であり、開発者個人の言語設定とは別の軸で決まる。
  3. **スクリプトが出力する固定文字列**: Telegram のヘッダーラベル（`Planning` / `Completion` など）、`Issue:` / `PR:` の URL ラベル、`--notify-message` 省略時の既定メッセージ。AI が書く文面ではなく、翻訳の仕組みも持たない。

`JOSH_SESSION_LANG` は **開発者個人の設定**であり、`.env`（gitignore 済み・非コミット）に置く。リポジトリ共有の設定ではないため、consumer ごと・開発者ごとに自由に変えてよい。`josh sync` で上書きされることもない。この変数はスクリプトの動作を一切変えない（どのスクリプトもこの変数を読まない）。制御するのは AI が書く文面の言語だけである。

## Step 1: Issue 作成テンプレ

Issue には次の要素を必ず含める。

- タイトルは簡潔で明瞭な英語で記載する（本文やコメントと違い、タイトルは「出力の言語（`JOSH_SESSION_LANG`）」の例外として常に英語。日本語で作成した場合は、AIツールが実装開始前に英語タイトルへ変換する。すでに英語で書かれている場合でも、文法・明確さ・簡潔さの観点で改善できるなら書き換えて良い。いずれの場合も GitHub Issue のタイトルを `gh issue edit` で合わせて更新する）
- 目的（何を改善したいか）
- 現象（現在の不具合や課題）
- 期待結果（完了時の状態）
- 受け入れ条件（検証方法、対象画面/機能）

最小テンプレート:

```md
## 背景

<なぜ必要か>

## 現象

<現在の問題>

## 期待結果

<どうなれば完了か>

## 受け入れ条件

- [ ] 条件1
- [ ] 条件2

## Origin

<別リポジトリのセッションから起票した場合のみ。起票元 Issue を `owner/repo#N` 形式で書く。自リポジトリ発の Issue では節ごと省略する>
```

### 起票元へのバックリンク（`## Origin` / `## Upstream issues`）

**別リポジトリのセッションから起票した Issue には、起票元へのリンクを必ず書く。** 上流 Issue は欠陥そのものを述べるが、その欠陥が「どのプロジェクトで・どのバージョンの組み合わせで・どんな出力として現れたか」という証拠は消費者側の Issue にしかない。リンクはその証拠へ戻る唯一の経路であり、半年後にその Issue を読む人にとっては本文と同じだけ重要である。

**双方向とも必須**（片方向では、上流の修正を待っている消費者側が「何を待っているのか」を辿れない）:

| 方向                  | 置き場所                      | 固定見出し              | 内容                                                 |
| --------------------- | ----------------------------- | ----------------------- | ---------------------------------------------------- |
| 上流 Issue → 起票元   | 上流 Issue の本文             | `## Origin`             | 起票元 Issue（`owner/repo#N` または URL）            |
| 起票元 Issue → 上流   | 起票元 Issue の本文かコメント | `## Upstream issues`    | そこから起票した上流 Issue を全件列挙する            |
| 起票元 Issue → 未起票 | 起票元 Issue の本文かコメント | `## Upstream candidate` | 第三者リポジトリへ報告する候補（**未起票**）と下書き |

- **見出しは固定する**。「書いた人が置いた場所」ではなく grep で機械的に見つかるようにするため。起票元 Issue 側は、その場で本文を書いている最中なら本文に、既に本文が確定しているなら同じ見出しでコメントに書く
- **リンクは必ずリポジトリ修飾する**（`owner/repo#N` または完全 URL）。**裸の `#N` を使ってはならない** — 上流リポジトリ内では同番号の別 Issue に解決され、黙って誤ったものを指す
- **チェックボックス行（`- [ ] owner/repo#N`）で書いてはならない。散文か素の箇条書き（`- owner/repo#N`）にする。** `scripts/git/git-epic-parse.ts` の `has_external_task_list_entry` は「チェックボックス付きで他リポジトリを参照する行」を検出すると epic の自動クローズを無効化する。これは**本物の他リポジトリ子 Issue に対しては正しい挙動**（その状態は別リポジトリを指定しないと読めないため）だが、単なる後方参照をその記法で書くと epic が永久に open のまま残る。判定はチェックボックスの有無だけを見るので、素の箇条書きは安全である
- **未起票の候補には `## Upstream candidate` を使い、`## Upstream issues` を使わない**。後者は「既に起票した」ことを主張する見出しであり、third-party リポジトリへの報告はユーザーの明示指示があるまで起票しないため、両者は必ず別の見出しに置く（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
- 割り込みで起票する場合の手順は「別パッケージ起因の問題は割り込み Issue で対応する」、分割で起票する場合は下記 epic 節を参照

### 複数 Issue に分割するときの epic Issue

`kickoff new` が 1 つの要望を **2 件以上**の Issue に分割したとき、**常に**それらを束ねる epic Issue を作成する。件数や実行順序の有無で分岐しない。

なぜ必要か: 分割の根拠を「最初の Issue のコメント」に置くと、その Issue は `queue` が最初にマージしてクローズする対象でもあるため、残りの作業の設計図がクローズ済み Issue の中に埋もれる。epic の役割は、その情報の**閉じない置き場**を用意することにある。実行順序は epic が載せられる情報の一つであって、epic が存在する理由ではない。埋没は順序の有無と無関係に、複数分割のたびに起きる。

- **条件分岐を置かない。** 「件数が少ないうちは epic の管理コストが情報整理の利益を上回る」という以前の但し書きは、`scripts/git/git-epic-close.ts`（`pnpm josh followup` から駆動）が子 Issue の全クローズを検知して epic を自動クローズするようになった時点で根拠を失った。放置される epic という管理コストがもう存在しない以上、避けるべきは分岐の誤判定だけである。2 件・順序不問の分割に epic が付く冗長さは軽微で、分岐の見落としによる情報消失より常に安い
- epic には `epic` ラベルを付ける（未作成なら `gh label create "epic" --color "#5319e7" --description "Tracks a batch of child issues from one split" 2>/dev/null || true`）。放置された open epic を `gh issue list --label epic` で棚卸しできるようにするため
- **epic を `queue` に渡してはならない。** `queue` には子 Issue のみを渡す。epic には成果物がなく、実装ランを走らせる対象ではない
- epic は最後の子 Issue がクローズされた時点で `pnpm josh followup` が自動クローズする。マージ後に `epic` ラベルの open な Issue を探し、タスクリストの子が全てクローズ済みなら子を列挙したコメント付きで閉じる。1 件でも open なら放置し、この処理の失敗は警告のみでランを止めない。最終 PR に `closes #<epic>` を書く方法は、バッチが途中で失敗したときにも発火して未完了を完了扱いにするため採用しない
- 自動クローズは `epic` ラベルとタスクリスト記法の両方に依存する。どちらかを欠くと epic は open のまま残るので、手動でクローズする
- タスクリストが**他リポジトリの子 Issue**（`owner/repo#N` や URL 形式）を含む場合、自動クローズは行われない。その子の状態は別リポジトリを指定しないと読めず、無視すると open のまま epic を閉じてしまうため。この場合も手動でクローズする
- **分割そのものが別リポジトリのセッション発である場合**（消費者リポジトリでの `kickoff new` が上流に子 Issue を起票したなど）、各子 Issue の本文に `## Origin` を、epic 本文にも同じ起票元へのリンクを書く（→「起票元へのバックリンク」）。epic 側は `Split rationale` の直後に散文か素の箇条書きで置く。**チェックボックス行で書くと直前の項目に該当して自動クローズが止まる**ため、この 1 点だけは形式を守る。起票元 Issue 側にも `## Upstream issues` として起票した子 Issue と epic を列挙する
- epic 本文の `Dependencies` に依存の連鎖（`#N -> #M`）が書かれているのに、手順 4 の依存関係が**一件も付いていない**場合、`pnpm josh followup` が子 Issue のマージごとに警告する。連鎖の形は検査しない（タスクリストの並び順を依存順と推測することになり誤検知を生むため）。判定の起点を本文の宣言に置くのは、epic の存在がもう順序ありを意味しないため — 順序不問のバッチにも epic を作る以上、依存関係ゼロ件は正常な状態でもありうる

作成手順（既定）: **`pnpm josh epic` を使う。**

```bash
# 順序不問のバッチ
pnpm josh epic "<epic-title>" <N1> <N2> ...

# 実行順序があるバッチ（引数の並び順＝依存順）
pnpm josh epic "<epic-title>" <N1> <N2> ... --ordered

# 分割理由の散文を渡す（`-` で標準入力）
pnpm josh epic "<epic-title>" <N1> <N2> --rationale-file <path|->

# 別リポジトリのセッション発である場合のバックリンク
pnpm josh epic "<epic-title>" <N1> <N2> --origin <owner/repo#N>
```

このコマンドは上記 4 要件を**構成上**満たす。ラベルを用意してから付与し、子をタスクリスト記法で描画し、`Dependencies` を `--ordered` の有無で矢印連鎖／`None — ...` 固定文に振り分け、`queue` 行を子だけで組み立てる。`--ordered` のときは同じ入力から `gh issue edit --add-blocked-by` も適用するので、**本文の宣言と native な依存関係が食い違うことがない**（手順 4 の付け忘れが構造的に起きなくなる）。依存関係の付与が失敗しても件数を報告して続行する（`gh` 2.94.0 以降が必要で、失われるのは関係だけ）。

作成済みの epic は `pnpm josh epic:check <E>` で 4 要件を点検できる。手書きした epic、コマンド導入以前の epic、本文を手で編集した後の確認に使う。全要件を満たせば exit 0、満たさなければ exit 1 なのでゲートとしても使える。判定は自動クローズが読むのと**同じパーサ**（`scripts/git/git-epic-parse.ts`）を使うため、「自動クローズが読める形式」と「点検が通る形式」は定義上一致する。

作成手順（フォールバック）: **`josh` が使えない環境でのみ**、以下を手で行う。

1. 子 Issue を全て作成し、番号 `<N1> <N2> ...` を控える
2. `epic` ラベルを用意する（未作成なら `gh label create "epic" --color "#5319e7" --description "Tracks a batch of child issues from one split" 2>/dev/null || true`）
3. epic を作成し、番号 `<E>` を控える: `gh issue create --title "<epic-title>" --label epic --body "<body>"`
4. 実行順序が**ある場合のみ**、子 Issue に依存関係を付与する（後述の理由により**作成後の独立ステップ**として行う）:

   ```bash
   gh issue edit <N2> --add-blocked-by <N1>
   gh issue edit <N3> --add-blocked-by <N2>
   ```

   順序が不問なら手順 4 は行わない。epic の作成は無条件だが、依存関係の記録は順序が実在するときだけで、両者は独立している。

手順 2 の `|| true` はラベルが既に存在する場合を無視するためのもので、作成失敗を握り潰す危険はない。ラベルが存在しないまま手順 3 に進むと `--label epic` が解決できず `gh issue create` 自体が失敗するため、異常は必ずそこで顕在化する。

手順 4 は `gh` 2.94.0 以降が必要で、**失敗しても続行してよい**（付かないのは関係だけで、Issue とタスクリストは無傷）。作成時に `gh issue create --blocked-by` を使ってはならない — 古い `gh` は未知フラグを exit 1 で即座に拒否し、**Issue 自体が作られない**。作成と関係付与を分けることで、古い CLI での劣化が「Issue が消える」から「関係が付かない」に下がる。

epic 本文のテンプレート:

```md
## Split rationale

<なぜこの分割にしたか>

## Dependencies

#101 -> #102 -> #103 (#102 depends on the API added in #101)

## Execution

queue #101 #102 #103

## Progress

- [ ] #101 <title>
- [ ] #102 <title>
- [ ] #103 <title>
```

`Progress` は**必ずタスクリスト記法**（`- [ ] #N`）で書く。GitHub は参照先 Issue がクローズされた時点でこの記法のチェックボックスのみを自動で埋めるため、素のリンク（`#N` の直書き）では進捗が追跡されない。ただし全項目が埋まっても GitHub が epic 自体をクローズすることはない。

`Dependencies` は順序があるなら**必ず矢印記法**（`#101 -> #102`、`->` または `→`）で書く。`pnpm josh followup` の順序未記録チェックはこの記法を検出して初めて発火するため、`#102 depends on #101` のような散文で書くと、手順 4 を飛ばしても警告されない。順序が不問なら節ごと省略せず `None — the children are independent; any execution order works.` と明示する。空欄や節の削除では「順序がない」のか「書き忘れた」のかが読み手にもチェックにも区別できない。

#### ネイティブの依存関係と sub-issues

`gh` は Issue 間の関係をネイティブに扱える。下表のフラグと JSON フィールドは **2.97.0 の実バイナリで存在を確認済み**。導入バージョンを 2.94.0 とするのは `cli/cli` のリリースノート記載によるもので、2.94.0 自体での動作確認は行っていない。GitHub Enterprise Server では依存関係に 3.19 以降が必要（github.com では制約なし）。

| 種別     | 書き込み                                                                   | 読み取り                                                     |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 依存関係 | `gh issue edit <N> --add-blocked-by <M>` / `--add-blocking` / `--remove-*` | `gh issue view <N> --json blockedBy,blocking`                |
| 親子関係 | `gh issue edit <N> --parent <M>` / `--add-sub-issue`                       | `gh issue view <N> --json parent,subIssues,subIssuesSummary` |

**依存関係は採用する**（上記の作成手順 4）。子 Issue 単体を見たときに何を待っているかが GitHub の UI と API の両方から分かるようになり、epic 本文の `Dependencies` 行が人間向けの散文でしかなかった問題が解消する。ただし依存関係は**表示するだけで着手を防がない**ため、順序を守る責任は引き続き `queue` の呼び出し順にある。epic 本文の `Dependencies` 行は、関係が付かなかった環境でも読める冗長な記録として残す。

**sub-issues（親子関係）は採用しない。** 理由は 2 点 — 親子関係は「包含」を表すだけで実行順序を表現できない、および親子関係は同一リポジトリオーナー内に限られる。いずれも CLI の対応状況とは無関係で、2.94.0 以降でも変わらない。

## Step 2: 提案依頼（AI 共通）

Issue URL を渡して、次の観点で提案を依頼する。

- 要件の分解
- 実装候補（複数案がある場合は比較）
- 影響ファイル
- テスト方針（unit/e2e）
- リスクと回避策

最小プロンプト:

```md
Issue: <issue-url>

以下を提案してください:

1. 要件分解
2. 実装方針（必要なら複数案）
3. 変更予定ファイル
4. テスト戦略（unit/e2e）
5. リスクと対策
```

## Step 3: 計画コメントを記録して通知する

1. 提案を人間が判断する
2. 採用した計画を Issue に記録する（Issue body が空の場合は `gh issue edit <N> --body "<plan>"` で body に書き込む。body が既にある場合は `gh issue comment <N> --body "<plan>"` でコメント追加する）
3. Telegram で計画開始を通知する:

   ```bash
   pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>'
   ```

   - `--task-type` はヘッダーのアイコンを決める（`planning` 📋 / `completion` ✅ / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️）
   - `--repo-name` と `--issue-title` は未指定なら `gh` から自動取得される
   - Issue URL を必ず含める
   - 箇条書きの間に改行を入れて読みやすくする
   - `kickoff` コマンドの場合はここで **停止** する（実装に進まない）

4. ワークフロー開始時点で作業ツリーにステージング済みまたは変更済みのファイルが既にある場合（例: ユーザーが事前に kit/設定ファイルをステージングした場合）、先に変更を退避する:
   ```bash
   git stash
   ```
5. メインブランチへ切り替えて最新を取得する:
   ```bash
   git switch main && git pull
   ```
6. 依存関係を最新化し、脆弱性を確認する（**必須—作業ツリーに変更があっても省略してはならない**。`pnpm latest` は内部で `pnpm audit` も実行する）:
   ```bash
   pnpm latest
   # 脆弱性が見つかった場合: package.json の overrides に対象バージョンを追加して pnpm install 後に再確認
   ```
   ステップ 4 で stash した場合は、ここで復元する:
   ```bash
   git stash pop
   ```
7. **作業サマリを提示してから**実装を開始する（`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` の Code Change Rules Step 0）。書式は下記「報告フォーマット（平易な概要 ＋ 技術詳細）」に従う — `JOSH_SESSION_LANG` の言語で、平易な概要 3 行を先頭に置き、技術詳細（触るファイル / モジュール、アプローチとその理由、副作用・スコープ外、テスト宣言）はその下に置く。

   `fullrun` / `halfrun` / `queue` では Issue ごとに 1 回、実装に着手する直前に提示する。**Issue body が既に埋まっていて計画コメントを投稿しなかった場合も必ず提示する**（この場合ユーザーには他に作業内容が見えないため）。`kickoff` は既に計画を Issue に投稿するので対象外。

   提示は説明のためであり、**確認待ちで停止する意味ではない**。同一ターンでそのまま実装へ進むこと（停止条件にはならず、`/code-review` → `followup --merge` のチェーン規則にも影響しない）。セッション向け出力のみに留め、Issue コメントとしては投稿しない。

8. 実装完了後、**lint/test より前に** `prompts/refactoring.md` に従ってリファクタリングを適用する（高・中優先度項目が残らなくなるまで収束させる）
9. 検証ゲート（`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` の Completion gate）を実行する

`pnpm josh git` の基本実行（`-y` で確認プロンプトをスキップ）。**初回コミット前に必ず `pnpm josh bump minor` を実行する。** ただし、同一 PR 内の追加修正コミット（CodeRabbit 指摘対応など）では実行しない。

```bash
pnpm josh bump minor
pnpm josh git -y "<issue-title> #<issue-number>"
```

> **Note**: Issue タイトルは `pnpm josh git` を実行する前に、簡潔で明瞭な英語に整えること。
> 日本語で書かれている場合は英語に変換する。すでに英語で書かれている場合でも、文法・明確さ・簡潔さの観点で改善できるなら書き換えて良い（AI ツールは実装前にタイトル品質を判断する）。
> いずれの場合も `gh issue edit <number> --title "<english-title>"` で GitHub Issue タイトルを合わせて更新する。

### Recovery after failed push (pre-push hook blocked)

If `pnpm josh git -y` fails at the push step (e.g. blocked by the pre-push hook), fix the blocking issue and then recover with:

```bash
# 1. Push manually after fixing the issue
git push --set-upstream origin <branch>

# 2. Create the PR only — closes #N keyword is preserved
pnpm josh pr
# equivalent: pnpm josh git -y --skip-commit --skip-push
```

**Do not** run `gh pr create` directly — it bypasses `build_body` which generates `closes #N`, causing the Issue to remain open after merge.

`fullrun` フローでは、コミット後かつ `pnpm josh followup --merge` 実行前に `/code-review` スキルを実行する。高・中優先度の指摘が見つかった場合は修正を行い、再度 `/code-review medium` を実行してから次のステップへ進む。**レビューは合計 2 回まで**であり、2 回目を終えた時点で残る Low/Medium は follow-up Issue に切り出す（`prompts/review.md` → "Review round cap"）。

### `fullrun` STOPPING CONDITIONS — read this before you stop

**`fullrun` / `fullrun new` / `queue` may stop in exactly 2 situations. If neither applies, the chain MUST continue without user input.**

1. **PR is merged, the `completion` Telegram notification has been sent, AND `pnpm josh ms` has returned the working tree to the default branch.** This is the normal end state. The agent reports the PR URL and stops.
2. **A genuine blocker requires user judgment.** Exactly these three count as blockers:
   - A CodeRabbit / Claude Review substantive finding that the agent cannot auto-verify as a false positive (see "Verify CodeRabbit findings before bypassing").
   - The managed config-file confirmation gate (`josh sync`-distributed files in the diff).
   - A CI failure that requires user input to resolve.

   When a blocker fires, the agent MUST send a `confirmation` Telegram **before** stopping (per "Mid-workflow stop notification").

**Everything else — including a `/code-review` skill returning a polished "Approve for merge" recommendation — is NOT a stopping condition.** The agent continues straight through `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` in the same turn.

### レビュー工程は実装セッションがコミット前に実行する

ワークフロー内のレビュー工程（各フローの `/code-review medium`）は、**実装したセッション自身が、コミットの前に**インラインで実行する。対象は `git diff main`、実行時期は検証ゲートの最終段（refactor → lint → tsc → cspell → test:unit → `/code-review medium`）であり、`fullrun` / `halfrun` / `queue` のいずれも同じ時期・同じ対象でレビューする。High/Medium がなくなるまでその場で修正して再実行し、**指摘を潰し切ってから最初のコミットを作る**。ただし**再実行は 2 周まで**であり、2 周を終えた時点で残る High 以外の指摘は follow-up Issue に切り出して現在の Issue を完了させる（`prompts/review.md` → "Review round cap"）。したがって PR に貼るレビューコメントも、ラウンドごとのコミットや CI 再実行も発生しない。

**フレッシュコンテキストのサブエージェントに委譲する方式（kit#752）と、PR 作成後に実行して結果を PR コメントとして投稿する方式（kit#758）は、これを置き換えるものではなく、これに置き換えられた。** 別コンテキストのレビュアーは実装者のバイアスを持ち込まない利点があったが、毎ラウンド変更を読み直し、指摘のたびに修正コミット・push・必須チェック 6 件の CI 再実行が走るため、PR 作成からレビュー確定まで 10 分を超えるのが常態だった（kit#758 の PR 自身が 3 ラウンドで 10 分 53 秒）。**レビュアーが実装者と同一コンテキストである点は、この方式が受け入れているトレードオフである** — 作者の思い込みが素通りする確率は上がるが、コミット前セルフレビュー（`prompts/review.md`）は従来どおり必須のゲートとして残る。

### Chain rule: `/code-review` → `followup --merge` decision table

The `/code-review` skill output is a Markdown review with sections, severity-tagged findings, and a final recommendation. **It is an intermediate step, not a turn boundary.** Map the result mechanically:

| `/code-review` result                    | Severity of findings | Next action (same turn, no user input)                                                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean — every category says `No issues`  | None                 | Immediately continue: `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                                                                                                                |
| Findings, but all are Low                | Low only             | Immediately continue: `bump minor` → `git -y` → `followup --merge` (Low findings may be skipped with a one-line reason per Pre-commit Self-Review)                                                                                                                                   |
| One or more High / Medium findings       | High and/or Medium   | Fix in place and re-run `/code-review medium` on `git diff main` — **at most two reviews in total**（`prompts/review.md` → "Review round cap"）。Nothing is committed yet, so a round costs no commit, push, or CI run. Do NOT report the findings narratively to the user and wait. |
| `/code-review` itself errors / can't run | n/a                  | Report the error and stop with a `confirmation` Telegram (treat as a CI-level blocker)                                                                                                                                                                                               |

The recommendation line at the bottom of the `/code-review` output ("Approve for merge", "Request changes", etc.) is **informational, not authoritative**. The severity of findings drives the decision, not the recommendation sentence.

### Anti-pattern catalog (concrete violation phrases — self-recognize these)

If the agent is about to emit text that resembles any of the following, it is violating the chain rule. Cancel the message, run `pnpm josh followup --merge` instead.

- "The `/code-review` is clean — ready to merge. Shall I proceed with `followup --merge`?"
- "`/code-review` found no high/medium findings. Approve for merge after you confirm."
- "Recommendation: Approve for merge. Let me know if you'd like me to continue."
- "All green. Awaiting your go-ahead to merge."
- "The review is complete. Should I run `pnpm josh followup --merge` now?"
- Posting the `/code-review` Markdown output and then stopping the turn without a tool call.
- Listing low-severity findings narratively and asking whether they should block merge (Low findings are auto-skipped with a one-line reason; do not escalate).
- Treating CodeRabbit rate-limit warnings as findings (they are not — proceed).

These all share the same shape: presenting the `/code-review` outcome to the user and waiting. The user invoked `fullrun`; merging is part of that invocation. **The chain ends at a stopping condition above, never at `/code-review` output.**

This rule applies regardless of model (Claude / Gemini / Cursor) or account; the workflow is portable and the chain must hold across environments.

### Turn-end self-check (fullrun-conditional) — run BEFORE sending any response that contains `/code-review` output

The chain rule above has been violated repeatedly even with the decision table and anti-pattern catalog in place (PR #387 on 2026-05-15, PR #398 on 2026-05-20). The rule needs to be visible at the **exact moment of violation** — when the response is about to be sent. Run this check, in order, before sending any response containing `/code-review` output:

1. **Mode check** — Is this `/code-review` part of a `fullrun` / `fullrun new` / `queue` invocation? Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) the implementation is finished and the verification gate has reached its review step. A `halfrun` invocation never satisfies (a): halfrun runs the same review inside its gate but ends at the confirmation stop without committing. If either is false → **standalone mode**; stop after the review markdown, do NOT call `followup --merge`. This conditional prevents auto-merging when the user runs `/code-review <PR>` standalone for a code-review-only purpose.
2. **Severity check** — Count high/medium findings across all categories. If ≥1 → fix in place and re-run `/code-review medium`. Nothing is committed yet, so the loop costs no commit or CI run. **Stop at two rounds** — after the second, file every remaining Low/Medium finding as a follow-up Issue and continue the pipeline; a standing High blocks the merge but does not authorize a third round（`prompts/review.md` → "Review round cap"）。 Do NOT call `followup --merge` yet.
3. **Append check** — If in fullrun mode AND 0 high/medium findings (Low-only or fully clean) → the same response that contains the `/code-review` markdown MUST also contain a `pnpm josh followup "<title> #<N>" --merge --notify-message "..."` tool call **after** the review markdown. **A response whose final assistant text is `/code-review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call before sending.

The check fires at the moment your response would end with review markdown and no follow-on tool call. That is the violation point. Treat the `/code-review` skill's output as an intermediate tool result, not a deliverable.

This self-check is mirrored at the end of the `/code-review` skill prompt (`prompts/review.md`) so it is visible inside the skill's own execution context — not just in the always-loaded project docs.

### Tooling enforcement (investigated, not implemented)

A `pnpm josh review --auto-followup` style CLI wrapper was investigated as part of this rule. **It is not feasible at the tooling layer**: `/code-review` is an interactive AI skill that returns Markdown for the agent to interpret — a shell command cannot host the skill, parse its severity verdicts, or decide "no high/medium" on the agent's behalf. The strongest available enforcement is the decision table, anti-pattern catalog, and turn-end self-check above, sitting in always-loaded context (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`) plus the skill prompt (`prompts/review.md`).

## 報告フォーマット（平易な概要 ＋ 技術詳細）

作業前サマリ（Step 7）と完了報告（Step 5）は、**平易な概要を先頭に置き、技術詳細をその下に降格する 2 層構造**で書く。ここが横断ドキュメント（`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`）のカノニカル参照。

理由: 報告の読み手は実装者とは限らない。ファイル名・型名・オプション名が並ぶ説明は「何が原因で、どう対応し、結果どうなったか」を伝えない。詳細を消すのではなく、**先に結論を平易な言葉で伝え、詳細は読み飛ばせる位置に置く**。

### 出力はコードフェンスで囲まない（必須）

以下のテンプレートは **フェンスの中身だけ**をセッションに書く。フェンス（` ``` `）自体はこのドキュメントでテンプレートの範囲を示すための区切りであり、**出力には含めない**。

理由: セッション出力はターミナルでマークダウンとして描画される。フェンスで囲むとブロック全体に背景色と等幅フォントが当たり、平易な概要を読みやすくするという書式の目的と正面から衝突する。特に日本語の文章は等幅で詰まって読みづらくなる。

そのため、テンプレートは**素のマークダウンとして成立する形**で定義してある。空白を並べた桁揃えは使わない（マークダウンは連続空白を 1 つに潰すため崩れる）。ラベルは太字、行は箇条書きで表す。`---` を単独行に置くのも避ける（水平線として描画される）。

### ラベルはセッション言語に訳し、注釈は付けない（必須）

ラベルについての規則は 2 つあり、**混ぜてはならない**。1 文にまとめると「書かれている通りに出す」＝「英語のまま出す」と読めてしまい、日本語セッションなのにラベルだけ英語で並ぶ出力になる。

**(1) ラベルはセッション言語に訳す。** テンプレートは英語ドキュメント側の定義であり、セッションにはその訳を出す。日本語セッションでの対応:

| 英語ドキュメントのラベル               | 日本語セッションでの表記                     |
| -------------------------------------- | -------------------------------------------- |
| `■ Overview`                           | `■ 概要`                                     |
| `Now` / `Change` / `Check`             | `今こうなっている` / `こう直す` / `確かめ方` |
| `Details`                              | `技術詳細`                                   |
| `Changes and tests`                    | `変更とテスト`                               |
| `Cause` / `Fix` / `Result`（完了報告） | `原因` / `対応` / `結果`                     |

英語のまま残すのは誤り。成果物の散文（Issue 本文、Issue／PR コメント、Telegram 本文）も同じく `JOSH_SESSION_LANG`（未設定なら `ja`）で書き、その中の `Cause` / `Fix` / `Result` などのラベルもこの対応表に従って訳す。英語のまま残るのは「出力の言語（`JOSH_SESSION_LANG`）」が挙げた 3 つ — Issue／PR タイトル、コード規約（コメント・テストタイトル・コミットメッセージ）、スクリプトが出力する固定文字列 — だけである。

**(2) ラベルに注釈を付けない。** 書式の説明（「平易な説明」「先頭に置く」など）を括弧書きでラベルに足さない。`■ 概要（平易な説明）` は誤りである。

理由: ドキュメント側のラベルに AI 向けの注意書きを埋め込むと、それがラベルの一部として読まれ、セッション出力にそのまま — あるいは翻訳されて — 現れる。読み手にとっては意味のない内部向けの注記が、最初に目に入る行を占めることになる。**注意書きはラベルではなく、ラベルの下の説明文に置く**。`**技術詳細**` `**変更とテスト**`、および完了報告の `**■ 完了報告**` も同じ扱い。

### 作業前サマリ（セッション向け・`JOSH_SESSION_LANG` の言語）

```md
**■ 概要**

- **今こうなっている**: <1文 — 利用者から見て何が起きているか>
- **こう直す**: <1文 — 手段ではなく、直った後どうなるか>
- **確かめ方**: <1文 — どう確認するか>

**技術詳細**

- 対象: <触るファイル / モジュール>
- 方針: <アプローチとその理由>
- 副作用 / スコープ外: <意図的にスコープ外にした点。なければ省略>

**変更とテスト**

1. <変更内容> — Test: <Unit|E2E> — `<file path>` — <検証する挙動>
2. ...
```

### 完了報告（セッション向け）

```md
**■ 完了報告**

- **原因**: <1文 — なぜそうなっていたか>
- **対応**: <1文 — 何をしたか>
- **結果**: <1文 — 利用者から見て何が変わったか>（v<version>）

**技術詳細**

- 変更ファイル: <...>
- テスト結果: <...>
- 残課題: <なければ「なし」>
```

### 概要 3 行の書き方（ここが本体）

長さ制限だけでは平易にならない。**語彙と抽象度を制約する**:

- 各行は 1 文・短く（日本語で 80〜100 字、英語で 20〜25 語）
- 概要にファイルパス・関数名・型名・CLI のオプションフラグ（＝内部識別子）を書かない（すべて技術詳細セクション側）。ただし利用者が画面で目にする名前は書いてよく、むしろ必要 — この禁止は下記「具体的な主語を必ず書く」と必ずセットで読む
- 専門用語は使わないか、`〜（＝…のこと）` の形でその場で言い換える
- 変更点の羅列ではなく **原因 → 対応 → 効果の因果**で書く
- 主語は利用者・システムの振る舞い。「利用者から見て何が違うか」が書けないなら、その行はまだ技術詳細のまま

**送信前セルフチェック（`/code-review` チェーン規則の自己チェックと同じ位置づけ）**: 報告を送る直前に次の 2 点を確認する。

1. 概要 3 行にファイル名・記号・英略語が混じっていないか、プログラマでない人が読んで意味が通るか。混じっていたらその語を技術詳細へ移してから送る
2. サマリ全体をコードフェンスで囲んでいないか。囲んでいたらフェンスを外し、上記テンプレートの素のマークダウン形に直してから送る
3. コードを見ていない読み手が、概要 3 行だけで**どれの話か特定できるか**。特定できないなら、下記に従って具体的な名詞を 1 つ足してから送る

### 具体的な主語を必ず書く（禁止と対になる要求）

上の「書かない」規則だけを守ると、今度は**何の話か特定できない**概要になる。「古いまま」「案内されたコマンド」「状況が変わらない」— 文としては成立しているが、どのパッケージが古く、何を案内したのか、代わりに何が出るのかが一切分からない。禁止規則が、利用者が実際に画面で目にする名詞にまで過剰適用された結果である。

そこで、禁止と対になる**要求**を置く:

- **何かが「古い」「壊れている」「変わらない」と書くときは、その対象を名指しする。** 対象パッケージ名・画面名・出力の種類のいずれかを必ず含める
- **主語のない「状況」「案内」「問題」「その処理」だけで済ませない。** 読み手がどれのことか特定できない指示語は書き換える
- **書いてよい具体名**: 利用者が画面で目にするもの — パッケージ名、表示されるコマンドの目的、画面名、メッセージの種類
- **書いてはいけない具体名**: 内部識別子のみ — ファイルパス、関数名・型名、CLI のオプションフラグ

字数を 80〜100 字としたのはこの要求と両立させるため。60 字では対象を名指しする余地が残らず、抽象化するしかなくなっていた。

**悪い例**（何の話か特定できない）:

```md
- **今こうなっている**: 古いままだと警告が出るのに、案内されたコマンドを実行しても状況が変わらないことがある。
- **こう直す**: 効き目のない案内は理由の説明に置き換え、同じ案内が何度も並ぶのもやめる。
- **確かめ方**: 自動テストで、無駄な案内が消え・重複が消え・従来の表示は変わらないことを確かめる。
```

**良い例**（同じ内容で、対象を名指ししている）:

```md
- **今こうなっている**: バージョン確認が「全体で使う app-kit が古い」と警告するのに、一緒に出る更新コマンドは既に入っている版を指していて、実行しても何も変わらず同じ警告がまた出る。
- **こう直す**: 何も変えられないコマンドを出すのをやめ、なぜ変えられないかを一行で説明し、同じコマンドが並ぶときは 1 つにまとめる。
- **確かめ方**: 自動テストで、効かないコマンドが説明に置き換わり、重複が 1 行になり、通常の表示は変わらないことを確かめる。
```

悪い例と良い例の違いは長さではなく、**名指ししているかどうか**にある。良い例には内部識別子は 1 つも出てこない。

### 成果物（Issue / PR / Telegram）側

言語は「出力の言語（`JOSH_SESSION_LANG`）」に従う — `JOSH_SESSION_LANG` の言語、未設定なら `ja`。**構造も**セッション向けと同じ 2 層にする。`--notify-message` は `Added ... / Changed ...` の羅列ではなく、`Cause / Fix / Result` の 3 行を先頭に置き、変更点の箇条書きを `Details:` 以下にまとめる（書式は Step 5 の例を参照）。

## Step 5: PR結果確認 + 完了通知（別スクリプト）

`pnpm josh git` の後に、別スクリプト `pnpm josh followup` を実行する。

`pnpm josh followup` の主な動作:

- Cloudflare / CodeRabbit / SonarQube の結果確認（Required チェックのみ待機。CodeQL 等の non-required チェックは待たない）
- CodeRabbit 指摘の未対応検出（必要なら理由コメント投稿）
- AI レビューコメントのスキャン（Claude Review / CodeRabbit サマリコメント）。CI ステータスとは独立に実行する。ブロッカー該当コメントが残っている場合は `confirmation` Telegram 通知を送り非ゼロ終了する（`--ai-review-ignore-reason` を渡した場合のみ PR にスキップ理由コメントを投稿して続行）
- Issue への完了通知投稿（Issue body が空なら body を編集、既にあればコメント追加）
- Telegram 通知: 成功時のみ `task_type=completion`（✅）を自動送信する。CI 失敗や例外は単に再スローされるだけで、Telegram 通知は出さない。**`completion` 通知は必ずこの自動送信経路を使うこと。`pnpm josh notify --task-type completion ...` を手動で呼び出してはならない**（詳細は下記「`completion` 通知は `pnpm josh followup` 経由のみ」を参照）
- 失敗の Telegram 通知は AI ツールが **最終的に復旧を諦めた** と判断したときに限り、手動で 1 回だけ送る: `pnpm josh notify --task-type failure --issue-url "<issue-url>" --body "<理由と未解決点>"`（再試行ごとに送らない）

主なオプション:

- `--notify-target`: `issue`（固定。PR への完了報告は行わない）
- `--notify-message`: Issue への完了コメント本文。`JOSH_SESSION_LANG` の言語（未設定なら `ja`）で、「報告フォーマット」の 2 層構造に従う — 先頭に `Cause: / Fix: / Result:` の 3 行（各 1 文、専門用語・ファイル名なし）、続けて `Details:` 以下に変更点の箇条書き。`Added ... / Changed ...` だけの羅列にしない
- `--coderabbit-ignore-reason`: 未対応を残す場合の理由コメント
- `--ai-review-ignore-reason`: AI レビュー（Claude Review / CodeRabbit サマリ）の未対応ブロッカーを残す場合の理由コメント
- `--issue-number`: Issue 番号（または位置引数に `"<title> #<number>"`）

例1: 基本（`fullrun` ではマージも込み）

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>
Cause: <why this was needed, in one plain sentence>
Fix: <what was changed, in one plain sentence>
Result: <what is different for the user now>

Details:
- Added ...
- Changed ..."
```

例2: CodeRabbit 未対応理由あり

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ...
- Fixed ..." \
  --coderabbit-ignore-reason "仕様上この指摘は該当しないため"
```

例3: AI レビュー（Claude Review）の未対応ブロッカー理由あり

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ...
- Fixed ..." \
  --ai-review-ignore-reason "該当指摘は別 Issue #123 で追跡中のため"
```

例4: マージなし（`kickoff` 後や手動マージが必要な場合）

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ..."
```

### AI レビューコメントのスキャン（Claude Review / CodeRabbit サマリ）

`pnpm josh followup` は CI 完了後、`gh pr view <branch> --json comments` で取得した PR のトップレベルコメントをスキャンし、AI レビュアーが残した未対応の指摘を検出する。**CI がオールグリーンでも、AI レビュアーのブロッカー指摘が残っていれば完了しない**。

**一時措置（kit#753）**: CodeRabbit のレビューが遅い間、CodeRabbit は全経路で非ブロッキングになっている — 既定の必須チェックから除外（`JOSH_REQUIRED_CHECKS` で復元可）、`Actionable comments posted: N` は情報ログへ格下げ、未解決の行コメントも理由なしで通過する。スキップした事実はコンソールと完了 Telegram 本文に記録される。Claude Review のブロッカー動作は従来どおり。kit#752 と併せて元に戻す。

- ブロッカー判定ヒューリスティック（保守的・構造ベース／NLP は使わない）:
  - **Claude Review**（`author.login = claude`）: 本文に `### Issues` / `### Problem` / `#### Logic bug` / `### 1. ...` などの番号付き指摘見出しを含む
  - **CodeRabbit**（`author.login = coderabbitai` / `coderabbitai[bot]`）: 本文に `Actionable comments posted: N` を含み `N > 0`。レート制限通知（`rate limited by coderabbit.ai` / `Rate limit exceeded`）や `No actionable comments` は無視する
- ブロッカーが残っていて `--ai-review-ignore-reason` が未指定の場合: `confirmation` Telegram 通知を送り、非ゼロで終了する。指摘を修正してから再実行するか、意図的に無視する理由を渡す
- `--ai-review-ignore-reason "<reason>"` を渡した場合: 無視理由コメントを PR に投稿したうえで完了通知まで進める（`--coderabbit-ignore-reason` と同じ流れ）

### 設定ファイル更新の確認（`pnpm josh followup` 実行中）

`pnpm josh followup` が CI ステータスチェックの処理を完了した後、`git diff main...HEAD` で PR に `josh sync` が管理・配布するファイル（`playwright.config.ts`、`.github/workflows/ci.yml` など）への変更が含まれていないかを確認する。管理設定ファイルが更新されている場合は、次のコミットの前に停止して `confirmation` Telegram 通知を送る:

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'CI ステータスチェックが管理設定ファイルの更新を検出\n変更内容を確認してから次のステップに進んでください'
```

- ユーザーから明示的な確認が得られるまで、次のコミット・修正・マージのいずれも行わない
- このチェックは AI レビューコメントのスキャンとは独立して実行する — 同一の実行中に両方がトリガーされることもある

## `epicrun` — EPIC 配下の子 Issue を無人で実行する

`epicrun #<E>`（別リポジトリの EPIC を参照する場合は `epicrun owner/repo#<E>`）は、EPIC の子 Issue を人が張り付かずに完走させるためのワークフローキーワードである。実行手順の正典は本節であり、運用手順は `.claude/skills/workflow-commands/epicrun.md` に置く。両者は一致していなければならない。

`queue` との違いはひとつだけである。`queue` は 1 件ごとに人の明示起動を安全弁にしており、実装中に判断が必要になればセッション全体が停止する。停止のタイミングが予測できないため、人はランの間じゅう張り付く必要がある。`epicrun` は**判断が必要になった子 Issue だけを脇に置いて他の子へ進む**。

### 1 回の起動が承認する範囲

**`epicrun` を 1 回打つことが、その EPIC 配下の N 件のマージ・複数リポジトリへの push・実行中の Issue 自動作成をまとめて承認する。** これがキーワードの存在理由であり、毎ターンの再承認を求める `queue` との差である。

EPIC の外側は承認しない。Tier C の行動は従来どおり停止する — ただし停止するのはその子 Issue だけである。

### 並行度モデル — repo あたり同時 1 件、repo 間は並行

実行状態を GitHub 側にのみ置く設計（`josh epic:next`）の帰結として、**`epicrun` は 1 セッションである必要がない**。リポジトリごとにセッションを立て、各セッションが同じ EPIC に対して `josh epic:next <E> --repo <owner/repo>` を呼び、自分のリポジトリの子だけを取って走る。

**ただし現時点ではこれは 1 セッションである。** `josh epic:next` は EPIC も子もセッションが立っているリポジトリから読むため、別リポジトリのセッションはその EPIC を見つけられない。別リポジトリの EPIC を参照する形（`epicrun owner/repo#E`）と、別リポジトリの子の解決は joshuafolkken/kit#864 が持つ。`--repo` フラグとリポジトリ単位の束ね方は既に実装済みなので、#864 は本節を書き換えるのではなく広げる形になる。以下の理由づけは、その拡張が保たなければならない前提である。

**競合制御は不要であり、実装もしない。** 各セッションが自分のリポジトリの子だけを取り、同一リポジトリ内は 1 件ずつと決まっているため、2 つのセッションが同じ子を掴む状況が構造的に発生しない。**この性質は per-repo scoping からのみ来ている。同一リポジトリ内の並行を認めた時点で失われるので、それを扱う後続 EPIC ではあらためて排他制御が論点になる。** 本節を「並行実行に調整は要らない」と読んではならない。

同一リポジトリ内の並行を本 EPIC の範囲外とする理由は、`josh bump minor` が同じ `package.json` を書き換えること、1 つのチェックアウトが worktree なしに 2 ブランチを保持できないこと、同じファイルを触る子に衝突予測が要ること、の 3 つである。**いずれもリポジトリを共有していることに固有の理由**であり、リポジトリが別なら manifest が別ファイルで、チェックアウトが既に分かれており、ファイルを共有せず、Actions もマージキューもリポジトリごとに独立しているため、ひとつも当てはまらない。したがって repo 間の並行は本 EPIC の範囲に含める。

並行で速くなるのは依存が無い子だけである。app-kit の子が kit の新機能を必要とするなら `blocked-by` に宣言され、`epic:next` が正しく待たせる。これは並行実行の限界ではなく依存関係そのものである。

### park and continue — 判断が要る子は脇に置いて先へ進む

実行中に、そのランが決めてよい範囲を超える事柄（Tier B の拮抗した選択、Tier C の行動、上流起因の欠陥、人の判断を要する分割）が生じたら、**その子 Issue に `needs-decision` ラベルを付けて中断し、依存していない他の子へ進む**。

**park はセッション停止の置き換えであって、停止を生んだルールの置き換えではない。** 上流の欠陥は従来どおり即座・無条件に起票し（first-party なら Tier A）、回避策を書くことは引き続き禁止である。変わるのは停止の及ぶ範囲だけで、その子は待ち、ランは続く。

**park の解除は Tier A（確認不要）。** 決定が EPIC の `## Decisions` に記録された時点で AI がラベルを外し、`epicrun` を再実行すれば続きから走る。これが human-in-the-loop の後半であり、これが無いと park した子は永久に止まる。

### `in-progress` の解除は、stale を検知したセッションが行う

`in-progress` を外す処理はコードベースに存在しない。正常終了なら Issue が閉じるので無害だったが、中断したランの子には付いたまま残り、その子は以後すべての `epic:next` の候補から永久に外れる。**stale を検知したセッションが自分でラベルを外し（Tier A）、報告してからループを続ける。**

### 待機と終了の判定 — ラベルではなく「人の入力なしに解けるか」

| `josh epic:next` の分類                           | `epicrun` の挙動                                 |
| ------------------------------------------------- | ------------------------------------------------ |
| 着手可能あり                                      | 実行する                                         |
| 着手可能ゼロ・時間で解ける子あり                  | **待機する**                                     |
| 着手可能ゼロ・時間で解ける子なし・open な子が残る | **終了して報告する**（人が要る子の一覧を添える） |
| open な子が無い                                   | 終了する                                         |

ラベルで判定してはならない理由は具体的である。kit の子が closed になり app-kit の子が公開待ちで止まっている瞬間は、着手可能ゼロ・`in-progress` ゼロ・`needs-decision` ゼロになる。ラベルを見る判定では終了と誤り、**待つべき場面で終了する**。

### 待機の実体（無限待ちにしない具体値）

| 設定                        | 値     | 理由                                                                  |
| --------------------------- | ------ | --------------------------------------------------------------------- |
| ポーリング間隔              | 60 秒  | 子 1 件の `fullrun` は分単位。これより短くしても API 消費が増えるだけ |
| `in-progress` の stale 判定 | 90 分  | 子 1 件の実測所要を超える。これを過ぎたら相手セッションは落ちている   |
| 公開待ちのタイムアウト      | 10 分  | `josh propagate` と同じ budget。publish が失敗すれば永久に出ない      |
| ラン全体のタイムアウト      | 8 時間 | 一晩で終わらない無人ランは、追加の待機ではなく人を必要としている      |

**いずれも打ち切って報告する** — 無限にリトライするものは一つも無い。stale と判定した子はラベルを外してから次のポーリングへ進む。循環依存による詰みは `epic:next` が検出してエラーにするため、`epicrun` は待機を打ち切って報告する側に徹する。

### 実行中に分割が必要と分かった場合

子 Issue を新規に起票し、EPIC のタスクリストに追加して依存を記録する（first-party への起票は Tier A、確認不要）。分割の判定基準は `kickoff` の分割判定と同一の定義を使う。分割後の残りに人の判断が要るなら、元の子に `needs-decision` を付けて park し、他の子へ進む。**分割そのものを理由にセッション全体を止めない。**

### ガード（暴走の上限）

| ガード                 | 上限 | 到達時                                                       |
| ---------------------- | ---- | ------------------------------------------------------------ |
| 1 ラン内の子の件数     | 30   | 停止して報告する。これより大きい EPIC は分割すべきである     |
| 1 ラン内の自動起票件数 | 10   | 停止して報告する。これを超えて起票するランは筋を見失っている |
| 連続失敗               | 3 回 | 停止して報告する。問題は子ではなく環境の側にある             |

連続していない失敗はその子を park してランを続ける。

### 通知と後処理の担当

複数セッションで走る場合、**EPIC の完了サマリを送るセッションと `josh propagate` を走らせるセッションは、EPIC を所有するリポジトリに立っているセッションの 1 つに定める。** `propagate` 自身も供給元リポジトリの外では実行を拒否するため、2 つの規則は一致する。他のセッションは、自分のリポジトリの子が無くなった時点で静かに終了する。

子ごとの completion 通知は従来どおり `pnpm josh followup --merge` が送る。これに加えて、ランの開始時に EPIC の開始通知を、終了時に「何をマージし、何を park し、何を起票したか」を含む完了サマリを送る。

### 停止条件

`epicrun` が止まってよいのは次の 5 つだけである。

1. `epic:next` が `complete` を返した — サマリを送信済み
2. `epic:next` が `stop` を返した — 残る子はすべて人を要する。一覧を添えて報告する
3. `epic:next` が `error` を返した — 循環依存、または宣言と関係の食い違い
4. 上記ガードのいずれかに到達した
5. 上記タイムアウトのいずれかが経過した

**判断が必要になった子は、この一覧に含まれない。** park してランを続ける。

## 別パッケージ起因の問題は割り込み Issue で対応する

作業中（実装・検証・レビュー対応のいずれの段階でも）に新たな課題を発見した場合、**即席対応を優先せず根本的な解決を先に行う**。発見した問題が、実は別パッケージ（依存パッケージや、このプロジェクトが消費している配布元 = kit / `josh` ツールなど）に起因する場合でも同様で、現在のリポジトリ内のローカル回避策（ハック・パッチ・回避コード）で押し切ってはならない。根本原因を **対象パッケージ側** で解決する。

### 無条件ルール: 起票は確認なし、停止は必ず

**この手順に「これは今の作業をブロックするか？」という判定は一切存在しない。** 上流の欠陥は、ブロックするものもしないものも、**発見した時点で**同じ手順を通る。例外はない。

- **トリガーは「発見」であって「ブロックし始めたとき」ではない**。ブロック判定は作業を先へ進めたい圧力の下で下されるため、回避策が最も魅力的な瞬間に「ブロックしない」へ倒れる。しかも「ブロックするか」の線は発見時点には存在しない — 非ブロックに見えた欠陥が完了ゲートで初めて牙を剥いたときには、既に手心が加えられた後である。判定そのものを置かないことで、一時凌ぎがツリーに入る前にルールが発火する
- **起票は Tier A（確認なし）**。起票してよいか、どのリポジトリへ起票するか、いずれもユーザー確認を取らない。起票は元々このルールが指示している行動であり、確認は何も生まない。**ただしこれが成り立つのは対象が first-party のときだけ**であり、third-party リポジトリへの書き込みは Tier C として明示指示を要する（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
- **停止は無条件**。Issue が存在する状態にしてから停止する。上流の修正を待つか先送りするかは、Issue を目の前にしたユーザーが決める
- **多少の冗長さは許容コスト**。ユーザーが素通りさせたはずの発見で停止しても往復 1 回で済むが、見送るべきだった発見を素通りさせると、回避策が全消費者に配布されるリポジトリへ入る。たまに外す判断より、毎回適用する一律ルールを採る
- **`epicrun` の中では、停止の範囲がセッション全体ではなくその子 Issue に限定される**。起票は変わらず無条件（first-party なら Tier A）で、回避策の禁止も変わらない。変わるのは停止の及ぶ範囲だけであり、該当の子に `needs-decision` を付けて park し、依存していない他の子へ進む（→「`epicrun` — EPIC 配下の子 Issue を無人で実行する」）。回避策を書かせないという本来の目的は、起票と回避策禁止が保たれることで維持される

手順:

1. **現在の作業を退避する**: `git stash`（WIP コミットでも可）。退避したことを忘れないよう、この時点で stash を作る
2. **進行中の Issue に状況を明記する**: `gh issue comment <N> --body "..."` で、(a) 作業を stash したこと、(b) 中断理由（どの別パッケージの・どんな問題で中断したか）、(c) 対象パッケージに作成した新 Issue へのリンクを `## Upstream issues` 見出しの下に `owner/repo#N` 形式で、を記載する。これにより「なぜこの Issue が一時停止しているか」と「何を待っているのか」が後から監査できる（→「起票元へのバックリンク」）
3. **対象パッケージのリポジトリに新しい Issue を作成する（確認なし）**: `gh issue create -R <owner>/<repo> --title "<root-cause title>" --body "<root cause and context>"`。根本原因・再現・期待結果を Step 1 のテンプレに沿って記載し、**本文に `## Origin` 節を置いて起票元 Issue を `owner/repo#N` 形式で書く**（→「起票元へのバックリンク」）。上流 Issue は欠陥を、起票元 Issue は証拠を持つため、リンクがないと上流 Issue は後から解釈できなくなる。ここで「起票してよいか」を尋ねて停止してはならない。**ただし確認なしで起票してよいのは対象が first-party のときだけ**で、third-party（owner が自リポジトリと一致しないリポジトリ）なら起票せずに停止する（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
4. **`confirmation` Telegram を送って停止する**: 上流 Issue の URL と、何が止まっているかを本文に書く（→「確認待ちで停止するときの Telegram 通知（`confirmation`）」）。無人実行でも画面外でユーザーが気付ける。停止は Issue が既に存在する状態で行うので、ユーザーは「待つ / 先送りする」を Issue を見ながら 1 語で答えられる
5. **元の作業を再開する**: 上流の修正がマージされた、または**ユーザーが先送りを明示判断した**後に `git stash pop` して、退避していた元タスクを続行する。上流 Issue を割り込みで実装するかどうかもユーザーの判断（上流パッケージの実装・PR・マージはそれぞれのワークフロー規則に従う）

### 第三者リポジトリへの書き込みは Tier C（明示指示が必要）

上の「起票は確認なし」は **first-party の集合**（kit / app-kit / game-kit / jgame）を前提に書かれている。トラッカーが自分たちのもので、重複起票のコストがバックログ 1 行で済むからである。**自分たちが所有しないリポジトリへの書き込みは、これとは別物**として扱う。

- **判定は機械的に行い、判断に委ねない**: 対象リポジトリの owner が、いまセッションが動いているリポジトリの owner と一致すれば **first-party**（`gh repo view --json owner --jq .owner.login`）。**それ以外は全て third-party** で、fork も、単に contribute しているだけの org リポジトリも third-party に入る
- **first-party は従来どおり**: Tier A。確認なしで起票し、双方向バックリンクを書き、停止する。kit / app-kit / game-kit のフローに新しい摩擦は加わらない
- **third-party は書き込みの種別を問わず Tier C**: Issue・コメント・PR・Discussion・レビューのいずれも、**その turn におけるユーザーの明示指示**なしに行ってはならない。公開は外向きかつ実質不可逆で、Issue はユーザーの GitHub アカウント名義で公開され、watcher へ通知され、検索に載る。後からクローズしてもそのいずれも取り消せない。加えて、誰も差し出すと約束していないメンテナの時間を消費する
- **third-party だと判明したときの手順**: (1) **自分たちの側の Issue** に証拠込みで所見を記録する。見出しは `## Upstream candidate` を使い、`## Upstream issues` は使わない（後者は「起票済み」を主張する見出しであるため）。(2) 報告本文の下書きをその Issue 内に用意し、ユーザーが 1 メッセージで承認できる状態にする。(3) 対象プロジェクト名と報告しようとしている内容を書いた `confirmation` Telegram を送って**停止する**
- **third-party 報告の証拠バー**（下書きを提示する前に満たす）:
  - **自プロジェクトの外で成立する最小再現**（対象の依存だけを入れた素の scaffold）。用意できない場合は「プロジェクト組み込みの再現しかない」ことを下書きに明記する
  - **本文の全主張が検証済み**であること。推測を事実として書かない
  - 同じ欠陥を扱う**既存 Issue の検索**
- **取り下げも外向きの行為**: 既に起票した third-party Issue のクローズ・編集・コメントも、同じく明示指示を要する
- **正しい診断は公開の許可ではない**。sveltejs/kit#16623 の事例では所見自体は上流のソースで検証可能な正しいものだったが、手順として誤っていた。所見の正しさは、この節のどの要求も免除しない
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Third-party repositories are Tier C」）のカノニカル参照

### 検証ゲートを緩めることも「回避策」である

ローカルに回避コードを書くことだけが違反ではない。**上流の欠陥に合わせて `lint` / `tsc` / `cspell` / unit / E2E の出力を絞り込む・狭める・読み替える行為も、ローカルパッチを書くのと同じ違反**であり、同じ停止を引き起こす。

- 典型例: 上流が配布する設定によって生成されるディレクトリ由来の型エラーを除外し、「プロジェクトソースはエラー 0」として完了ゲートを通過したことにする
- **絞り込んだことを正直に開示しても、ルールを満たしたことにはならない**。完了報告の読者は「緑ではない型チェック」を緑として受け取る
- 検証ゲートは上流の欠陥に合わせて調整しない。**調整したくなった時点が、このルールの発火点**である

注意:

- **即席回避と根本対応は「迷って選ぶもの」ではない**。上流起因と分かった時点で選択肢は根本対応だけであり、「今回は軽いから即席で」という判断はこの手順に存在しない
- 別パッケージへの新 Issue 作成・stash・Issue コメントは可逆かつ低コストな調査/起票操作なので、Tier C（不可逆・共有状態の操作）ではなく Tier A として確認なしで進める。ただし上流パッケージの **マージ等の共有状態操作** は通常どおりそれぞれのワークフローの明示起動を要する。**「可逆かつ低コスト」という前提が成り立つのは自分たちが所有するリポジトリに対してだけ**で、third-party への起票は外向き・実質不可逆なので Tier C になる（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Cross-package problems → file the upstream Issue, then always stop」）のカノニカル参照

## クローン禁止・単一ソース化（パッケージ境界を越えても）

既存の非自明なロジックを「ソースを変えずに済ませる」ために**コピー・移植・再実装することは既定で禁止**する。すでにどこか（別ファイル・別モジュール・別**パッケージ＝上流依存を含む**）に存在するロジックを複製しようとした瞬間が、**単一ソース化**（全消費者が import する共有モジュール／export／パッケージ）のシグナルである。コピーではなく単一ソース化する。

- **既存の重複は再重複の免罪符にならない**: すでに一度クローンされている（例: jgame が kit をコピー）なら、共有抽象化はとっくに必要だったということ。3 つ目のコピーを足さず、重複の存在を surface する
- **「上流を参照する」は「再利用する」の意**であって、「そのコードを貼り付ける」ではない
- **「X を触るな」という制約はクローンを黙って正当化しない**: クリーンな修正には上流（kit）の変更が要る／代替はクローン、というトレードオフを先にユーザーへ提示する（「クリーンな修正は kit の変更が必要、代替はクローン、どちらにする？」）
- 複製は、単一ソース化の代替案とそのコストを提示し、**ユーザーの明示承認を得た後にのみ**行う
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「No clones — single-source」）のカノニカル参照

## 相談と実行を区別する（議論中にファイルを編集しない）

ユーザーが「どう進めるべきか」「何をすべきか」「なぜそうなったか」を尋ねたり、目標・願望を述べたりした（「どうすべき？」「how should we…」「なぜ」「理由を知りたい」「〜したい」「〜の方が良い？」）ときは、**分析と推奨のみ**で応答する。ファイル編集・Issue 作成・その他の具体的アクションは取らない。

- 具体的アクションを取ってよいのは、明示的な命令（「do it」「書き換えて」「作成して」「implement」）またはワークフローキーワード（`kickoff` / `halfrun` / `fullrun` / `queue`）があるときだけ
- 曖昧なときは propose-and-wait を既定とする（「これを実行してよいか？」と尋ねる）
- **目標の表明は「計画の依頼」であって「実行の承認」ではない**
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Distinguish consultation from execution」）のカノニカル参照

## 配布ドキュメント・設定の変更は kit に上流化する

`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` および kit が配布する他のドキュメント／設定は、kit から単一ソースで配布される。

- **消費者リポジトリ（app-kit / game-kit）ではこれらをローカル編集しない**: `josh sync` が編集を上書きするうえ、変更は本来上流（kit）に属する。ドキュメント／設定を編集する前に、それが配布物かどうかを確認し、配布物なら kit 側に変更を提案（Issue／PR）する
- **kit リポジトリ自身ではあなたが配布元**なので、ここでは編集してよい。その際は 3 つの対ドキュメントを「Doc Sync Rules」に従って同期する
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Route distributed-doc / config changes upstream to kit」）のカノニカル参照

## 最新優先・fix-forward（pin-back は最終手段）

依存パッケージ・ツールチェーンは**既定で最新版を採用する**。バンプが lint クラッシュ・新規有効化ルール・型エラーなどの破壊を引き起こしても、古いバージョンへ留まる／戻すことを既定の「安全策」にしてはならない。破壊は**前向きに（fix-forward）速やかに**解消する。

1. **最新優先（latest-first）**: 依存・ツールチェーンは新しいバージョンを既定で採用する。適応の手間を避けるためだけに古いバージョンに留まったり戻したりしない
2. **破壊は fix-forward**: バンプで lint クラッシュ・新規ルール・型エラー等が出たら、前向きに解消する:
   - 新ルール／エラーが正当なら **消費者コードを直す**
   - ルール上書きが要るなら **正しいレイヤー**（kit / app-kit の共有設定）でスコープする。消費者リポジトリでの場当たり的な一回限りの disable にしない
   - 破壊が first-party パッケージ（kit / app-kit）起因なら、**そこに Issue を立てて適切な altitude で直す**。消費者側の回避だけで済ませない（→「別パッケージ起因の問題は割り込み Issue で対応する」参照）
3. **pin-back は最終手段**: fix-forward が本当に不可能／ブロックされている（例: 未リリースの上流修正待ち）ときだけ、古いバージョンへ固定する。固定するときは **理由を記録し、最新へ戻すためのトラッキング Issue を立てる**。pin-back を既定の推奨として提示してはならない
4. **既存の保護を尊重する**: この方針は overrides / `devEngines` の承認ゲートを上書きしない。fix-forward は _「最新を優先し破壊を直す」_ であって _「保護された pin を黙って書き換える」_ ではない。overrides（`pnpm-workspace.yaml` / `package.json` のいずれも）と `devEngines` の変更は従来どおりユーザーの明示承認を要する（→「overrides の保護（`pnpm-workspace.yaml` / `package.json` の両方を見る）」、および CLAUDE.md の `devEngines` 保護ルール参照）
5. **タイムリーに**: バンプ起因の破壊は、可能な限り同じ作業セッション内で速やかに対処し、pin の裏に先送りしない

- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Latest-first, fix forward — pin back only as a last resort」）のカノニカル参照

## 恒久ルールは MEMORY ではなくプロンプト／ドキュメントに書く

今後のセッションでも守るべき恒久的な振る舞いのルールに気付いたときは、**kit が配布するプロンプト／ドキュメント**（`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `prompts/*`）への変更として記述する。プロジェクト単位の自動 MEMORY（例: `~/.claude/projects/<repo-slug>/memory/`）への保存で済ませてはならない。

なぜプロンプト／ドキュメントが正なのか:

- **共有される**: バージョン管理下にありレビュー可能。PR で意図と経緯が残る
- **可搬**: `josh sync` で全消費者リポジトリに配布され、別の PC・別のリポジトリ・別の AI ツール（Claude / Gemini / Cursor）にも届く
- **監査できる**: いつ・なぜそのルールが入ったかを `git log` で追える

自動 MEMORY の性質と使いどころ:

- MEMORY は **1 台のマシン × 1 つのリポジトリ**にスコープされたローカルストアで、コミットされない。他の PC・他のリポジトリ・他の AI ツールからは見えない
- したがって **MEMORY への保存は最小限に留める**。用途は「本質的にローカルで共有しようがない文脈」だけ（マシン固有のパス、個人の環境の癖など）
- どこでも適用されるべきルールの唯一の置き場所を MEMORY にしてはならない

運用:

1. 恒久ルールに気付いたら、まず「これは kit のドキュメント／プロンプトに書くべきか？」を判定する。共有価値があるなら答えは常に yes
2. 現在のターンがドキュメント変更を承認していない（相談中など）場合は、**MEMORY に黙って保存せず、プロンプト／ドキュメント変更を提案する**（→「相談と実行を区別する」「配布ドキュメント・設定の変更は kit に上流化する」）
3. 消費者リポジトリで気付いた場合は、ローカル編集ではなく kit 側へ Issue／PR として上流化する
4. 既に MEMORY にあるルールが実は共有すべきものだと分かったときは、プロンプト／ドキュメントへ移し、MEMORY 側の重複エントリは削除する

- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Durable rules belong in prompts/docs, not local MEMORY」）のカノニカル参照

## 運用ルール

- 通知は CI チェック成功後に投稿する
- 通知投稿に失敗しても、実装完了の事実はログで確認できるようにする
- 自動投稿される Issue コメント文面は `JOSH_SESSION_LANG` の言語（未設定なら `ja`）で記載する。Issue タイトルだけは英語で固定する

### CI チェック失敗時の対応

`pnpm josh followup` は Required チェックのみ待機するが、**Workers Builds（Cloudflare デプロイ）など非 Required チェックが失敗した場合も必ずユーザーに明示的に報告する**。

- `gh pr checks` の結果を確認し、失敗しているチェックがあればすべて列挙する
- 修正できた場合: 修正内容を `--notify-message` に含める
- 修正できなかった場合: `--notify-message` に失敗チェック名・原因・未解決である旨を記載する。**完了コメントに失敗を隠してはならない**
- ユーザーへの報告も失敗の事実を正直に伝える（「成功」として扱わない）

### Auto-merge（default for `fullrun`）

`fullrun` / `fullrun new` の既定動作として、`pnpm josh followup --merge` が CI 待機・AI レビュー確認・完了通知・マージをまとめて行う。ユーザーが `fullrun` を実行した時点で、マージまで含めて承認されたものとみなす（追加キーワードは不要）。**マージ成功後は必ず `pnpm josh ms`（= デフォルトブランチへ checkout + `git pull`）を実行して、作業ツリーをデフォルトブランチ + 取り込み済みのマージコミットに戻す。`fullrun` / `fullrun new` / `queue` は常にデフォルトブランチ上で終了する。**

```bash
pnpm josh followup "<title> #<N>" --merge --notify-message "..."
pnpm josh ms
```

- **マージ完了後の `pnpm josh ms` は必須**: `pnpm josh followup --merge` は作業ツリーをマージ済みフィーチャーブランチに残したまま終了する。`pnpm josh ms` を続けて実行することでデフォルトブランチに戻り、マージコミットを取り込んだ最新状態になる。マージ自体が失敗した場合（ワークフローが既に停止している場合）はスキップしてよい
- **AI レビュー指摘は自動チェック**: `pnpm josh followup --merge` は CI グリーン後に AI レビュアーの指摘をスキャンする。ブロッカーが残っていれば `confirmation` 通知を送って非ゼロで終了する（マージされない）。指摘を修正して `pnpm josh followup --merge` を再実行する。**CI がオールグリーンでも、未対応の AI レビュー指摘があるならマージしない**
- **CodeRabbit のレート制限はマージを止めない**: CodeRabbit のコメントが rate limit 警告のみ（本文に `rate limited by coderabbit.ai` または `Rate limit exceeded` を含む）で実体のあるレビューが無い場合、または最新 commit に対して CodeRabbit のコメントが一切無い場合は、**レート制限切れとみなしてマージへ進む**
- **CodeRabbit 指摘は反射的にバイパスしない**: CodeRabbit が実体ある指摘を出した場合、まず指摘内容が正しいかを検証する。例: `pnpm/action-setup@<sha> # v6.0.8` のような GitHub Actions の SHA pin について「タグと一致しない」と指摘された場合、CodeRabbit は `gh api repos/<owner>/<repo>/git/ref/tags/v6.0.8` を実行している可能性が高い。これは **annotated tag-object SHA** を返すが、GitHub Actions の pin に使うのは **commit SHA**。`gh api repos/<owner>/<repo>/commits/<tag> --jq '.sha'` で確認し、これが pin と一致するなら偽陽性。その場合は検証根拠を `--coderabbit-ignore-reason "<検証コマンドと出力>"` に明記してバイパスする
- **マージ戦略**: 内部で `gh pr merge <branch> --merge` を実行する。既定は `--merge`（merge commit）。リポジトリが `allow_squash_merge` / `allow_rebase_merge` のみを許可している場合はそれに合わせる（`gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` で確認）
- **ブランチ削除**: `--delete-branch` は既定で付けない。ブランチ削除は別途ユーザーが指示する
- **失敗時の対応**: branch protection 未達・コンフリクトなどでマージが拒否された場合は、原因を報告して停止する。フラグを変えて再試行したり保護をバイパスしたりしない
- **マージをスキップしたい場合**: `pnpm josh followup` に `--no-merge` フラグを渡すか、`kickoff`（planning のみ）を使うか、同じターンで明示的に "do not merge" と伝える。`fullrun` の外では勝手に `gh pr merge` を実行してはならない

### 明示的な起動が必須（MANDATORY）

`kickoff` / `halfrun` / `fullrun` / `queue` ワークフロー（`#N` および `new` バリアントを含む）は、ユーザーが**現在のターンのプロンプト**にキーワードを入力していない限り、絶対に開始してはならない。

- 「実装して」「修正して」「PR を出して」などの会話的な依頼は暗黙の起動ではない。タスクがこれらのワークフローに該当すると判断した場合でも、依頼の形状から起動を推測してはならない
- 「`halfrun new` を実行してもよいですか？」「`fullrun` を回しますか？」のような確認質問もしてはならない。確認プロンプトは明示的な起動の代替にはならない
- 代わりに、**ユーザー自身にコマンドを入力してもらうよう促す**。次の形式を使う: 「このタスクは \`<command>\` で起動してください」。例: 「このタスクは \`halfrun new\` で起動してください」「Issue を実行するには \`fullrun #412\` を実行してください」。ユーザーが次のターンで自分でコマンドを入力する
- 過去のターンで関連ワークフローを承認していた場合でも、このルールは適用される。各起動は現在のターンでユーザーが再入力する必要がある

### 指示されていない行動は取らない

PR マージ・ブランチ削除・force push・共有ブランチへの push・外部通知の追加送信・リポジトリ設定の変更など、**共有状態に影響する操作はその場でユーザーに明示指示されたものだけ実行する**。

- `fullrun` の auto-merge は上記のとおり `fullrun` の指示自体に含まれるため許可される。それ以外の状況で勝手にマージしてはならない
- `kickoff` / `pnpm josh followup` 単独実行は文書化されたスコープで終了する。PR が OPEN のまま完了したら状態を報告して停止する
- 「チェックが全部 green だから次のステップに進む」は承認ではない
- **`gh pr merge` の直接実行は kit 配布の `.claude/settings.json` の `deny`（`Bash(gh pr merge*)`）で機械的に遮断されている。** `fullrun` の auto-merge は `pnpm josh followup --merge` が node スクリプト内部から gh を起動するため影響を受けない — Bash マッチャに見えるのは `pnpm josh …` だけで、承認済みのマージ経路だけが通る
- **共有状態に影響する操作（このセクションの対象＝Tier C）は迷ったら確認する。** 確認のコストは低いが、意図しない操作の巻き戻しは高コスト
- ただしこの「迷ったら確認」は Tier C に限る。**可逆な実装・設計判断（Tier A）は別ルール**（CLAUDE.md「Decision autonomy」の3層ポリシー）に従い、明確に優位な選択肢は確認せず自動で選んで記録する — 本当に甲乙つけがたい（Tier B）ときだけ確認する。下記「意思決定の自律ポリシー」を参照

### git index を勝手に変更しない（自律 staging の禁止）

**git の index（ステージング領域）はユーザーのものである。** ユーザーは「後の変更を差分で見るための基準スナップショット」として意図的にステージしていることがあり、`git add` / `git add -A` / `git rm --cached` / `git restore --staged` はそれを上書きする。index には履歴がないため、**上書きされた直前のステージ状態は復元できない**。

- **調査目的の staging は絶対に行わない。** 「diff stat を出したい」「未追跡ファイルの中身を差分で見たい」といった理由で `git add` してはならない。これが実際に事故（ユーザーが意図的に作ったスナップショットの破壊）を起こしたケースがある
- **調査は読み取り専用コマンドで行う**:
  - 変更ファイル一覧: `git status --short`
  - 作業ツリーの差分: `git diff` / `git diff --stat` / `git diff HEAD`
  - ステージ済みの差分: `git diff --staged`（読み取りのみ、index は変えない）
  - **未追跡ファイルの中身**: `git diff --no-index /dev/null <new-file>`（staging 不要）。あるいは単にファイルを直接読む
- **staging してよいのは次の 2 ケースだけ**:
  1. ユーザーが**そのターンで明示的に**ステージを指示した
  2. 承認済みのコミットフローの一部として実行される（`pnpm josh git`、および `fullrun` / `queue` の起動に含まれるコミット手順。`halfrun` はコミットしないので含まれない）
- 上記以外で staging が必要だと考えたときは、**実行せずに先に確認する**
- 同じ理由で、`git reset` / `git checkout -- <path>` / `git restore <path>` など index や作業ツリーを破壊的に書き換える操作も、自分の判断で実行しない
- **`git stash` は例外的に、明文化されたフローの中でのみ自動実行してよい**: `fullrun new` / `halfrun new` の手順 5（作業ツリーに変更がある状態で `josh latest` を回す前の退避）、`queue` の手順 1、および「別パッケージ起因の問題は割り込み Issue で対応する」。いずれも直後に `git stash pop` で復元することが手順に含まれている。これら以外の場面で退避したくなったときは、実行せずに先に確認する
- **この禁止は kit 配布の `.claude/settings.json` の `deny`（`Bash(git add*)` / `Bash(git stage*)` / `Bash(git rm*)` / `Bash(git mv*)` / `Bash(git reset*)` / `Bash(git restore --staged*)` / `Bash(git restore -S*)` / `Bash(git commit -a*)` / `Bash(git commit --all*)`）で機械的にも遮断されている。** `pnpm josh git` は node スクリプト内部から git を起動するため影響を受けず、承認済みのコミットフロー（上記ケース 2）は従来どおり動く。**deny には「そのターンでユーザーが明示指示した」という例外がないため、上記ケース 1 も AI 側では実行できない** — その場合はユーザー自身の端末で実行してもらう（ユーザーの手元では従来どおり動く）。恒久的な機械的保証のほうが、コマンド 1 本で回避できる例外より価値が高いという判断（joshuafolkken/kit#850）
- **「拒否される操作」と「禁止された操作」は同じ集合ではない。** deny に載っているのは上記の直接実行だけで、このセクションが同じく禁じている `git checkout -- <path>` / `git restore <path>` は実行できてしまう。**ツールが通したことを許可と読み替えてはならない** — 何をしてよいかを決めるのは deny ではなくこのルールである
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Git Rules」→「Never stage or mutate the git index on your own」）のカノニカル参照

### 意思決定の自律ポリシー（確認停止を減らす）

AI ツール（Opus / Gemini / Cursor）が判断の分岐で止まりすぎるのを防ぐため、各判断を3層に分類して扱う。停止して確認するのは**本当にユーザーの判断が必要な分岐だけ**にする。このセクションが横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Decision autonomy」）のカノニカル参照。

- **Tier A — 可逆な実装・設計判断**（明確に優位な選択肢があるライブラリ選定、命名、ファイル構成、テスト手法、リファクタの形）。メリット比較で1案が明確に優位なら**確認せず自動で選んで進める**。本来ユーザー確認すべき分岐だった場合は、後から監査・差し戻せるよう判断を記録する（下記「自動判断の記録」）
- **Tier B — 本当に甲乙つけがたい判断**。上位2案がどちらも妥当で差が僅差。**ここだけが停止する層** — ユーザーに確認する（`AskUserQuestion` が使えるなら使う）。拮抗する候補とトレードオフを提示する
- **Tier C — 不可逆・共有状態・スコープ外の操作**（マージ、ブランチ削除、force push、破壊的操作、リポジトリ設定変更、タスク範囲外の変更、`devEngines` / overrides の編集（`pnpm-workspace.yaml` `overrides:` と `package.json` `pnpm.overrides` のいずれも））。**このポリシーの対象外。** 1案が明確に優位に見えても、常にユーザーの明示指示を要する。既存の安全ルール（上記「指示されていない行動は取らない」、`devEngines` / overrides 保護）が優先される

**A と B の判定基準**: 確認するのは「差が僅差 **かつ** 後戻りしにくい／アーキテクチャに長く影響する」ときだけ。「迷っている」だけでは停止理由にならない — 明確に優位な選択肢は多少の不確実性が残っても自動で選び、僅差でも安価に巻き戻せる選択は自動で決めて記録して進む。

**Tier A に含まれる「自己修正」**: 次の 2 つは設計判断ではなく後始末であり、**確認せずに実行してよい**。

- **自分が公開した成果物の事実誤りの訂正**: Issue / PR コメントや Issue 本文の誤記・誤った帰属（例: 欠陥を実際とは別のパッケージに帰属させた記述）を、自分で訂正する
- **同じセッションで自分が特定した、自分の作業の抜けの穴埋め**: 例として、欠けていると自分で指摘した相互リンクを後から追加する

どちらも可逆で、望ましい結果が 1 つしかなく、放置をユーザーが選ぶことはない。**この半分に回避策のリスクはない** — 問題を迂回するのではなく、既に行った作業を修復するだけだからである。

- **「相談と実行を区別する」との境界**: ここでの Tier A は **すでに承認され実行された作業を完了・修復する**ことに限られる。目標の表明（「〜したい」）や進め方への問い（「どうすべき？」）に対して勝手に動いてよい、という意味ではない（→「相談と実行を区別する（議論中にファイルを編集しない）」）
- **Tier C との境界（再掲）**: 自分のコメントの訂正は Tier A。マージ・ブランチ削除・force push・スコープ外の変更は、**その問題を招いたのが自分自身であっても** Tier C のまま
- 記録は下記「自動判断の記録」に従う。確認を外しても監査証跡は外さない

**自動判断の記録**: 本来確認すべき Tier A の分岐を自動判断したときは、候補と理由を記録する:

- Issue 駆動ワークフロー内（`kickoff` / `halfrun` / `fullrun` / `queue`）: `gh issue comment <N> --body "..."` で、採用案・不採用の代替案・なぜ採用案が明確に優位かを記載する
- Issue が存在しない会話タスク: 同じ内容を「Auto-decided: `<choice>` over `<alt>` because `<reason>`」の1行として応答に明示する

### `completion` 通知は `pnpm josh followup` 経由のみ

`task_type=completion`（✅）の Telegram 通知は `pnpm josh followup` が自動送信する経路のみを使う。`pnpm josh notify --task-type completion ...` を手動で実行してはならない。

- 理由: 手動 CLI では `--pr-url` を明示しない限り PR URL が欠落する。`pnpm josh followup` は内部で `gh pr view <branch> --json url` から PR URL を取得して必ず付与するため、通知から PR リンクが消える事故を防げる
- 初回 PR 作成時・フォローアップコミット（CodeRabbit 指摘対応や再レビュー対応）・ブランチ再 push のいずれでも、完了を通知したいときは `pnpm josh followup "<title> #<issue-number>" --merge --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- <change1>\n- <change2>"` を再実行する（通知はマージ直前に送られる）
- `pnpm josh notify` は `planning` / `confirmation` / `kickoff_retry` / `failure` の 4 タスクタイプ専用。`completion` には使わない

### 確認待ちで停止するときの Telegram 通知（`confirmation`）

`kickoff` / `fullrun` 実行中に AI ツールがユーザーの確認・承認・指示待ちで停止するときは、停止の **直前に** Telegram 通知を 1 回送る。これにより、画面を見ていなくてもユーザーが応答すべきタイミングに気付ける。

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'<停止理由>\n<ユーザーに求める判断>'
```

- 本文が `-` で始まる場合は `--body=...` の形式（1 トークン）で渡す。スペース区切りでは `parseArgs` がエラーになる
- 同一の停止に対して通知は 1 回のみ。再評価のたびに送らない
- ユーザー自身がそのターンで停止を指示した場合は通知しない（既に把握しているため）

### overrides の保護（`pnpm-workspace.yaml` / `package.json` の両方を見る）

overrides に設定された制約は、**セキュリティ・互換性・動作保証のために意図的に追加されたもの**である。

**overrides は 2 箇所に置かれ、片方だけを見ても答えにならない。** pnpm 11 は `pnpm-workspace.yaml` の `overrides:` ブロックを読む（kit と app-kit の overrides は実際にここにある）。`package.json` の `pnpm.overrides` は旧来の置き場所である。**`pnpm.overrides` が空、あるいはそもそも `pnpm` フィールドが無いことは、そのプロジェクトに overrides が無いことの証拠にはならない** — app-kit の `package.json` には `pnpm` フィールドが一切無いが、`pnpm-workspace.yaml` には実際の override が存在する。`package.json` しか見ずに「保護すべき overrides は無い」と結論してはならない。それはルールが検出すべき状態そのもので合格を報告する振る舞いであり、しかも点検が空振りしたという信号を一切残さない（kit #740）。

- **確認は「実行するコマンド」であって「到達する結論」ではない。** `josh latest` / `pnpm update --latest` などの依存更新コマンドの実行後は、`git diff -- pnpm-workspace.yaml package.json` を実行し、`overrides:` ブロックと `pnpm.overrides` の双方が無傷であることを確認する
- `josh latest` は overrides の判定を自分で出力する（最後の overrides 行が `✔ overrides unchanged (<n> from <file>)`、変化していれば `⚠ overrides changed` 警告）。`pnpm josh overrides` は保存済みスナップショットと両ファイルを比較する。**実際に出力された行を引用して報告する**こと — 推測した判定を書いてはならない
- overrides が自動的に変更・削除された場合は、**理由を調査してから**ユーザーに報告し、明示的な承認なしに変更してはならない
- 例: `"esbuild@<=0.24.2": ">=0.25.0"` などのバージョン制約は、Workers ビルド互換性やパッケージの動作保証のために入れてある場合がある
