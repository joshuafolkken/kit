## Step 3: 計画コメントを記録して通知する

1. 提案を人間が判断する
2. 採用した計画をファイルに書き、`pnpm josh issue:plan <N> --body-file <path>` で Issue に記録する。書き込み権限のある作成者の body が空なら本文に、それ以外はコメントになる（本文はパスで渡す — `shell-body.md`）
   - 計画が stash の復元を含むときの書き方: `operating-rules.md` → "no-self-staging"
   - 計画には `### 影響を受ける既存の利用者` が必須（`pnpm josh plan:consumers <識別子...>` が下書きを出す。書き方: `kickoff.md` の手順 4）
3. Telegram で計画開始を通知する:

   ```bash
   pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>'
   ```

   - `--task-type` はヘッダーのアイコンを決める（`planning` 📋 / `completion` ✅ / `failure` ❌ / `warning` ⚠️ / `kickoff_retry` 🔄 / `confirmation` ⏸️）
   - `warning` は `pnpm josh followup` が自分で送る種別で、手で打たない（joshuafolkken/kit#1628）
   - `--repo-name` と `--issue-title` は未指定なら `gh` から自動取得される
   - Issue URL を必ず含め、箇条書きの間に改行を入れる
   - `kickoff` はここで**停止**する（実装に進まない）

実装からマージまでは [`fullrun-steps.md`](../../.claude/skills/workflow-commands/fullrun-steps.md) の手順に従う。
