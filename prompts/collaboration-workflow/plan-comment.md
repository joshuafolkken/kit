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

`fullrun` フローでは、コミット後かつ `pnpm josh followup --merge` 実行前に `/code-review` スキルを実行する。高・中優先度の指摘が見つかった場合は修正を行い、再度 `pnpm josh review:level` と `/code-review <what it printed>` を実行してから次のステップへ進む。**レビューは合計 2 回まで**であり、2 回目を終えた時点で残る Low/Medium は follow-up Issue に切り出し、**現在の Issue が閉じる前に `pnpm josh epic:bundle <新規>` を実行して答えに従う** — `add_to_epic` / `create_epic` は Tier A で、対応する `pnpm josh epic --add` / `pnpm josh epic` を実行する（本文の手編集は不可）。`ask` は停止（`epicrun` 中はその子を park）、`none` は何もしない（`prompts/review.md` → "Review round cap"、→「後追い Issue は起票した直後に EPIC へ束ね直す」）。

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

ワークフロー内のレビュー工程（各フローの `pnpm josh review:level` と `/code-review <what it printed>`）は、**実装したセッション自身が、コミットの前に**インラインで実行する。対象は `git diff main`、実行時期は検証ゲートの最終段（refactor → lint → tsc → cspell → test:unit → `/code-review` at the level `pnpm josh review:level` prints）であり、`fullrun` / `halfrun` / `queue` のいずれも同じ時期・同じ対象でレビューする。High/Medium がなくなるまでその場で修正して再実行し、**指摘を潰し切ってから最初のコミットを作る**。ただし**再実行は 2 周まで**であり、2 周を終えた時点で残る High 以外の指摘は、**内容から機械的に決まる 3 分岐**に振り分ける（`prompts/review.md` → "Review round cap"）。分岐は、既に触れているファイル内で数行・設計判断なしに閉じるなら**その場で直す（新しいレビュー巡は起こさない）**、実行経路に届くか判断が要るなら**起票する**、利用者に届かない Low なら**PR に 1 行残して落とす**、の 3 つ。同じ根本判断に帰着する複数の指摘は**1 件の Issue にまとめる**。起票する場合、**切り出しは起票では終わらない** — 直後に `pnpm josh epic:bundle <新規>` を実行し、`add_to_epic` / `create_epic` は確認せずに実行する（→「後追い Issue は起票した直後に EPIC へ束ね直す」）。したがって PR に貼るレビューコメントも、ラウンドごとのコミットや CI 再実行も発生しない。

**フレッシュコンテキストのサブエージェントに委譲する方式（kit#752）と、PR 作成後に実行して結果を PR コメントとして投稿する方式（kit#758）は、これを置き換えるものではなく、これに置き換えられた。** 別コンテキストのレビュアーは実装者のバイアスを持ち込まない利点があったが、毎ラウンド変更を読み直し、指摘のたびに修正コミット・push・必須チェック 6 件の CI 再実行が走るため、PR 作成からレビュー確定まで 10 分を超えるのが常態だった（kit#758 の PR 自身が 3 ラウンドで 10 分 53 秒）。**レビュアーが実装者と同一コンテキストである点は、この方式が受け入れているトレードオフである** — 作者の思い込みが素通りする確率は上がるが、コミット前セルフレビュー（`prompts/review.md`）は従来どおり必須のゲートとして残る。

### Chain rule: `/code-review` → `followup --merge` decision table

The `/code-review` skill output is a Markdown review with sections, severity-tagged findings, and a final recommendation. **It is an intermediate step, not a turn boundary.** Map the result mechanically:

| `/code-review` result                    | Severity of findings | Next action (same turn, no user input)                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues`  | None                 | Immediately continue: `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                                                                                                                                                      |
| Findings, but all are Low                | Low only             | Immediately continue: `bump minor` → `git -y` → `followup --merge` (Low findings may be skipped with a one-line reason per Pre-commit Self-Review)                                                                                                                                                                         |
| One or more High / Medium findings       | High and/or Medium   | Fix in place and re-run `/code-review` at the level `pnpm josh review:level` prints on `git diff main` — **at most two reviews in total**（`prompts/review.md` → "Review round cap"）。Nothing is committed yet, so a round costs no commit, push, or CI run. Do NOT report the findings narratively to the user and wait. |
| `/code-review` itself errors / can't run | n/a                  | Report the error and stop with a `confirmation` Telegram (treat as a CI-level blocker)                                                                                                                                                                                                                                     |

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
2. **Severity check** — Count high/medium findings across all categories. If ≥1 → fix in place and re-run `/code-review` at the level `pnpm josh review:level` prints. Nothing is committed yet, so the loop costs no commit or CI run. **Stop at two rounds** — after the second, route each remaining non-High finding through the three-way disposition: fix it in place without starting a new review round, file it, or drop it with a one-line PR note; for a filed finding, run `pnpm josh epic:bundle <new>` on it and execute an `add_to_epic` / `create_epic` answer without asking, then continue the pipeline; a standing High blocks the merge but does not authorize a third round（`prompts/review.md` → "Review round cap"）。 Do NOT call `followup --merge` yet.
3. **Append check** — If in fullrun mode AND 0 high/medium findings (Low-only or fully clean) → the same response that contains the `/code-review` markdown MUST also contain a `pnpm josh followup "<title> #<N>" --merge --notify-message "..."` tool call **after** the review markdown. **A response whose final assistant text is `/code-review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call before sending.

The check fires at the moment your response would end with review markdown and no follow-on tool call. That is the violation point. Treat the `/code-review` skill's output as an intermediate tool result, not a deliverable.

This self-check is mirrored at the end of the `/code-review` skill prompt (`prompts/review.md`) so it is visible inside the skill's own execution context — not just in the always-loaded project docs.

### Tooling enforcement (investigated, not implemented)

A `pnpm josh review --auto-followup` style CLI wrapper was investigated as part of this rule. **It is not feasible at the tooling layer**: `/code-review` is an interactive AI skill that returns Markdown for the agent to interpret — a shell command cannot host the skill, parse its severity verdicts, or decide "no high/medium" on the agent's behalf. The strongest available enforcement is the decision table, anti-pattern catalog, and turn-end self-check above, sitting in always-loaded context (`CLAUDE.md`) plus the skill prompt (`prompts/review.md`).
