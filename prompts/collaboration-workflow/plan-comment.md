## Step 3: 計画コメントを記録して通知する

1. 提案を人間が判断する
2. 採用した計画を Issue に記録する（Issue body が空の場合は `gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f body="<plan>"` で body に書き込む。body が既にある場合は `gh api repos/{owner}/{repo}/issues/<N>/comments -f body="<plan>"` でコメント追加する）
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
7. **作業サマリを提示してから**実装を開始する（`CLAUDE.md` の Code Change Rules Step 0）。書式は下記「報告フォーマット（平易な概要 ＋ 技術詳細）」に従う — `JOSH_SESSION_LANG` の言語で、平易な概要 3 行を先頭に置き、技術詳細（触るファイル / モジュール、アプローチとその理由、副作用・スコープ外、テスト宣言）はその下に置く。

   `fullrun` / `halfrun` / `queue` では Issue ごとに 1 回、実装に着手する直前に提示する。**Issue body が既に埋まっていて計画コメントを投稿しなかった場合も必ず提示する**（この場合ユーザーには他に作業内容が見えないため）。`kickoff` は既に計画を Issue に投稿するので対象外。

   提示は説明のためであり、**確認待ちで停止する意味ではない**。同一ターンでそのまま実装へ進むこと（停止条件にはならず、`/code-review` → `followup --merge` のチェーン規則にも影響しない）。セッション向け出力のみに留め、Issue コメントとしては投稿しない。

8. 実装完了後、**lint/test より前に** `prompts/refactoring.md` に従ってリファクタリングを適用する（高・中優先度項目が残らなくなるまで収束させる）
9. 検証ゲート（`CLAUDE.md` の Completion gate）を実行する

`pnpm josh git` の基本実行（`-y` で確認プロンプトをスキップ）。**初回コミット前に必ず `pnpm josh bump minor` を実行する。** ただし、同一 PR 内の追加修正コミット（CodeRabbit 指摘対応など）では実行しない。

```bash
pnpm josh bump minor
pnpm josh git -y "<issue-title> #<issue-number>"
```

> **Note**: Issue タイトルは `pnpm josh git` を実行する前に、簡潔で明瞭な英語に整えること。
> 日本語で書かれている場合は英語に変換する。すでに英語で書かれている場合でも、文法・明確さ・簡潔さの観点で改善できるなら書き換えて良い（AI ツールは実装前にタイトル品質を判断する）。
> いずれの場合も `gh api -X PATCH repos/{owner}/{repo}/issues/<number> -f title="<english-title>"` で GitHub Issue タイトルを合わせて更新する。

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

`fullrun` フローでは、コミット後かつ `pnpm josh followup --merge` 実行前に `/code-review` スキルを実行する。高・中優先度の指摘が見つかった場合は修正を行い、再度 `pnpm josh review:level` と `/code-review <what it printed>` を実行してから次のステップへ進む（**2 周目は差分全体の読み直しではなく修正の検証パス**。下記「レビュー工程は実装セッションがコミット前に実行する」）。**レビューは合計 2 回まで**であり、2 回目を終えた時点で残る Low/Medium は follow-up Issue に切り出し、**現在の Issue が閉じる前に `pnpm josh epic:bundle <新規>` を実行して答えに従う** — `add_to_epic` / `create_epic` は Tier A で、対応する `pnpm josh epic --add` / `pnpm josh epic` を実行する（本文の手編集は不可）。`ask` は停止（`epicrun` 中はその子を park）、`none` は何もしない（`prompts/review.md` → "Review round cap"、→「後追い Issue は起票した直後に EPIC へ束ね直す」）。

**`/code-review` の出力で停止してはならない**という連鎖規則の本文は、`.claude/skills/workflow-commands/chain-rule.md` にある — 停止してよい 2 状況、決定表、アンチパターン集、ターン終端セルフチェックはすべてそこが単一ソースである（joshuafolkken/kit#1186）。

### レビュー工程は実装セッションがコミット前に実行する

ワークフロー内のレビュー工程（各フローの `pnpm josh review:level` と `/code-review <what it printed>`）は、**実装したセッション自身が、コミットの前に**インラインで実行する。対象は `git diff main`、実行時期は検証ゲートの最終段（refactor → lint → tsc → cspell → test:unit → `/code-review` at the level `pnpm josh review:level` prints）であり、`fullrun` / `halfrun` / `queue` のいずれも同じ時期・同じ対象でレビューする。High/Medium がなくなるまでその場で修正して再実行し、**指摘を潰し切ってから最初のコミットを作る**。ただし**2 周目は 1 周目の反復ではなく、修正の検証パスである** — 対象は差分全体ではなく 1 周目の修正が触った範囲（fix delta）で、問いは「各指摘は実際に閉じたか／修正自体が欠陥を入れていないか」に変わる。基準は変わらず、閉じていない指摘は元の severity のまま残る（`prompts/review.md` → "The second round is a verification pass, not a second full review"）。**再実行は 2 周まで**であり、2 周を終えた時点で残る High 以外の指摘は、**内容から機械的に決まる 3 分岐**に振り分ける（`prompts/review.md` → "Review round cap"）。分岐は、既に触れているファイル内で数行・設計判断なしに閉じるなら**その場で直す（新しいレビュー巡は起こさない）**、実行経路に届くか判断が要るなら**起票する**、利用者に届かない Low なら**PR に 1 行残して落とす**、の 3 つ。同じ根本判断に帰着する複数の指摘は**1 件の Issue にまとめる**。起票する場合、**切り出しは起票では終わらない** — 直後に `pnpm josh epic:bundle <新規>` を実行し、`add_to_epic` / `create_epic` は確認せずに実行する（→「後追い Issue は起票した直後に EPIC へ束ね直す」）。したがって PR に貼るレビューコメントも、ラウンドごとのコミットや CI 再実行も発生しない。

**フレッシュコンテキストのサブエージェントに委譲する方式（kit#752）と、PR 作成後に実行して結果を PR コメントとして投稿する方式（kit#758）は、これを置き換えるものではなく、これに置き換えられた。** 別コンテキストのレビュアーは実装者のバイアスを持ち込まない利点があったが、毎ラウンド変更を読み直し、指摘のたびに修正コミット・push・必須チェック 6 件の CI 再実行が走るため、PR 作成からレビュー確定まで 10 分を超えるのが常態だった（kit#758 の PR 自身が 3 ラウンドで 10 分 53 秒）。**レビュアーが実装者と同一コンテキストである点は、この方式が受け入れているトレードオフである** — 作者の思い込みが素通りする確率は上がるが、コミット前セルフレビュー（`prompts/review.md`）は従来どおり必須のゲートとして残る。
