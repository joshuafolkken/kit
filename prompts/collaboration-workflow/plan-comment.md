## Step 3: 計画コメントを記録して通知する

1. 提案を人間が判断する
2. 採用した計画を Issue に記録する（Issue body が空の場合は計画をファイルに書き、`gh api -X PATCH repos/{owner}/{repo}/issues/<N> --field body=@<path>` で body に書き込む — 本文はパスで渡し、シェルの二重引用符には載せない（`shell-body.md`）。body が既にある場合は `pnpm josh issue:comment <N> --body-file <path>` でコメント追加する）
   - **計画が stash の復元を含むとき（会話で先に作った実装を stash でランへ渡す場合を含む）、復元手順には `pnpm josh stash:pop "<メッセージ>"` だけを書く。** `git stash apply` / `git stash pop` と「drop しない」という条件は書かない — 単一ソースは `operating-rules.md` → "no-self-staging"
3. Telegram で計画開始を通知する:

   ```bash
   pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>'
   ```

   - `--task-type` はヘッダーのアイコンを決める（`planning` 📋 / `completion` ✅ / `failure` ❌ / `warning` ⚠️ / `kickoff_retry` 🔄 / `confirmation` ⏸️）
   - `warning` は **`pnpm josh followup` が自分で送る種別** であり、手で打つものではない（joshuafolkken/kit#1628）
   - `--repo-name` と `--issue-title` は未指定なら `gh` から自動取得される
   - Issue URL を必ず含め、箇条書きの間に改行を入れる
   - `kickoff` コマンドの場合はここで **停止** する（実装に進まない）

4. ワークフロー開始時点で作業ツリーにステージング済みまたは変更済みのファイルが既にある場合、先に変更を退避する:
   ```bash
   git stash push -u -m "plan: pre-existing changes"
   ```
5. メインブランチへ切り替えて最新を取得する:
   ```bash
   pnpm josh ms
   ```
6. 依存関係の更新はコマンドに問う — `pnpm josh latest:scope` が `required` と答えたときだけ `pnpm josh latest` を実行し、`dependency-update` スキルに従う（単一ソースは `.claude/skills/workflow-commands/latest-gate.md`）。脆弱性への override は `pnpm-workspace.yaml` の `overrides` に書く（pnpm 11/12 は `package.json` の `pnpm.overrides` を無視する）。
   ステップ 4 で stash した場合は、ここでメッセージ指定で復元する（stash は全 work tree が共有するため、位置指定や引数なしの `git stash pop` は使わない — joshuafolkken/kit#2050）:
   ```bash
   pnpm josh stash:pop "plan: pre-existing changes"
   ```
7. **作業サマリを提示してから**実装を開始する（`CLAUDE.md` の Code Change Rules Step 0）。書式は `report-format.md` に従う。`fullrun` / `halfrun` / `backlogrun` では Issue ごとに 1 回、Issue body が既に埋まっていても必ず提示する（`kickoff` は計画を Issue に投稿するので対象外）。提示は説明のためであり、**確認待ちで停止しない** — 同一ターンでそのまま実装へ進み、Issue コメントとしては投稿しない。
8. 実装完了後、**lint/test より前に** `prompts/refactoring.md` に従ってリファクタリングを適用する（高・中優先度項目が残らなくなるまで収束させる）
9. 検証ゲート（`CLAUDE.md` の Completion gate）を実行する

`pnpm josh git` の基本実行（`-y` で確認プロンプトをスキップ）。**子はバージョンを上げない** — 版を決めるのは `pnpm josh release` ただ 1 箇所である（joshuafolkken/kit#1486）。Issue タイトルは実行前に整える（規則は `issue-template.md` の Step 1 冒頭）。

```bash
pnpm josh git -y "<issue-title> #<issue-number>"
```

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

### レビューからマージまで

レビューは実装したセッションが**コミットの前に** `pnpm josh review:brief` で始め、`/code-review` は `Agent` ツールのサブエージェントが実行する。ゲートとの重ね方、2 周の上限と 2 周目の検証パス、2 周の間で PR を開く位置、残った指摘の振り分けと `pnpm josh epic:bundle`、マージを打つターンは、すべて `.claude/skills/workflow-commands/chain-rule.md` が単一ソースである — "Run the review-to-merge chain"、"The review runs in a subagent, never a main-line skill load"、方針は `prompts/review.md` → "Review round cap"。**`/code-review` の出力で停止しない。**
