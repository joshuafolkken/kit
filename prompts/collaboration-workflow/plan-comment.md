## Step 3: 計画コメントを記録して通知する

1. 提案を人間が判断する
2. 採用した計画をファイルに書き、`pnpm josh issue:plan <N> --body-file <path>` で Issue に記録する。body が空なら本文に、空でなければコメントになる（本文はパスで渡す — `shell-body.md`）
   - 計画が stash の復元を含むときの書き方: `operating-rules.md` → "no-self-staging"
3. Telegram で計画開始を通知する:

   ```bash
   pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>'
   ```

   - `--task-type` はヘッダーのアイコンを決める（`planning` 📋 / `completion` ✅ / `failure` ❌ / `warning` ⚠️ / `kickoff_retry` 🔄 / `confirmation` ⏸️）
   - `warning` は `pnpm josh followup` が自分で送る種別で、手で打たない（joshuafolkken/kit#1628）
   - `--repo-name` と `--issue-title` は未指定なら `gh` から自動取得される
   - Issue URL を必ず含め、箇条書きの間に改行を入れる
   - `kickoff` はここで**停止**する（実装に進まない）

4. 作業ツリーの変更を退避する（変更が無ければ `clean` と答えて何もしない）:
   ```bash
   pnpm josh stash:push "plan: pre-existing changes"
   ```
5. メインブランチへ切り替えて最新を取得する:
   ```bash
   pnpm josh ms
   ```
6. `pnpm josh latest:scope` が `required` と答えたときだけ `pnpm josh latest` を実行し、`dependency-update` スキルに従う（`.claude/skills/workflow-commands/latest-gate.md`）。脆弱性への override は `pnpm-workspace.yaml` の `overrides` に書く（pnpm 11/12 は `package.json` の `pnpm.overrides` を無視する）。
   ステップ 4 が `stashed` と答えたら、ここでメッセージ指定で復元する（位置指定や引数なしの `git stash pop` は使わない — joshuafolkken/kit#2050）:
   ```bash
   pnpm josh stash:pop "plan: pre-existing changes"
   ```
7. **作業サマリを提示してから**実装を開始する（`report-format.md` → "作業前サマリはいつ・どう出すか"）。Issue body が埋まっていても提示し、Issue コメントとしては投稿しない。
8. 実装完了後、lint/test より前に `prompts/refactoring.md` に従い、高・中優先度項目が残らなくなるまでリファクタリングする
9. 検証ゲート（`CLAUDE.md` の Completion gate）を実行する

`pnpm josh git` を実行する（`-y` で確認プロンプトをスキップ）。**子はバージョンを上げない** — 版を決めるのは `pnpm josh release` だけ（joshuafolkken/kit#1486）。Issue タイトルは実行前に `issue-template.md` の Step 1 冒頭に沿って整える。

```bash
pnpm josh git -y "<issue-title> #<issue-number>"
```

### Recovery after failed push (pre-push hook blocked)

If `pnpm josh git -y` fails at the push step, fix the blocking issue and recover with:

```bash
# 1. Push manually after fixing the issue
git push --set-upstream origin <branch>

# 2. Create the PR only — closes #N keyword is preserved
pnpm josh pr
# equivalent: pnpm josh git -y --skip-commit --skip-push
```

Do not run `gh pr create` directly — it bypasses `build_body`, which writes `closes #N`.

### レビューからマージまで

レビューは実装したセッションがコミットの前に `pnpm josh review:brief` で始め、`/code-review` は `Agent` ツールのサブエージェントが実行する。周回の上限、残った指摘の振り分けと `pnpm josh epic:bundle`、マージを打つターンは `.claude/skills/workflow-commands/chain-rule.md` → "Run the review-to-merge chain"、"The review runs in a subagent, never a main-line skill load"、方針は `prompts/review.md` → "Review round cap"。**`/code-review` の出力で停止しない。**
