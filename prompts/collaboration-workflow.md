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

### セッション対話の言語（`JOSH_SESSION_LANG`）

ワークフローの出力は「チームに残る成果物」と「開発者との対話」で言語ポリシーが分かれる。

- **成果物は常に英語**: Issue タイトル、Issue／PR コメント、Telegram 通知は、開発者の設定に関わらず英語で記載する（Step 1 のタイトル正規化ルール、Step 3 の計画コメント、`--notify-message` の完了サマリーを含む）。
- **対話は `JOSH_SESSION_LANG` に従う**: セッション中の説明・質問、および `halfrun` などで提示する **`AskUserQuestion` の選択肢ラベル・説明** は、環境変数 `JOSH_SESSION_LANG`（例: `ja` / `en`）で指定された言語で出力する。未設定の場合は、ユーザーが書いている言語に合わせる。

`JOSH_SESSION_LANG` は **開発者個人の設定**であり、`.env`（gitignore 済み・非コミット）に置く。リポジトリ共有の設定ではないため、consumer ごと・開発者ごとに自由に変えてよい。`josh sync` で上書きされることもない。この変数はスクリプトの動作を変えず（成果物言語は英語のまま）、AI の対話出力言語のみを制御する。

## Step 1: Issue 作成テンプレ

Issue には次の要素を必ず含める。

- タイトルは簡潔で明瞭な英語で記載する（日本語で作成した場合は、AIツールが実装開始前に英語タイトルへ変換する。すでに英語で書かれている場合でも、文法・明確さ・簡潔さの観点で改善できるなら書き換えて良い。いずれの場合も GitHub Issue のタイトルを `gh issue edit` で合わせて更新する）
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
```

### 複数 Issue に分割するときの epic Issue

`kickoff new` が 1 つの要望を複数 Issue に分割したとき、**3 件以上になり、かつ実行順序に意味がある**（後続 Issue が先行 Issue に依存する）場合**のみ**、それらを束ねる epic Issue を作成する。

なぜ必要か: 分割の根拠と実行順序を「最初の Issue のコメント」に置くと、その Issue は `queue` が最初にマージしてクローズする対象でもあるため、残りの作業の設計図がクローズ済み Issue の中に埋もれる。子 Issue 側からも自分が何番目で何に依存しているかを辿れない。epic はその情報の**閉じない置き場**として機能する。

- **2 件の分割**、または**順序が不問**の分割では epic を作らない。この場合は依存関係を各子 Issue の本文に直接書く（`Depends on #N`）。件数が少ないうちは epic の管理コストが情報整理の利益を上回る
- epic には `epic` ラベルを付ける（未作成なら `gh label create "epic" --color "#5319e7" --description "Tracks a batch of ordered child issues" 2>/dev/null || true`）。放置された open epic を `gh issue list --label epic` で棚卸しできるようにするため
- **epic を `queue` に渡してはならない。** `queue` には子 Issue のみを渡す。epic には成果物がなく、実装ランを走らせる対象ではない
- epic は最後の子 Issue がマージされた後にクローズする。最終 PR に `closes #<epic>` を書く方法は、バッチが途中で失敗したときにも発火して未完了を完了扱いにするため採用しない

作成手順:

1. 子 Issue を全て作成し、番号 `<N1> <N2> ...` を控える
2. `epic` ラベルを用意する（未作成なら `gh label create "epic" --color "#5319e7" --description "Tracks a batch of ordered child issues" 2>/dev/null || true`）
3. epic を作成し、番号 `<E>` を控える: `gh issue create --title "<epic-title>" --label epic --body "<body>"`
4. 子 Issue に依存関係を付与する（後述の理由により**作成後の独立ステップ**として行う）:

   ```bash
   gh issue edit <N2> --add-blocked-by <N1>
   gh issue edit <N3> --add-blocked-by <N2>
   ```

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

   提示は説明のためであり、**確認待ちで停止する意味ではない**。同一ターンでそのまま実装へ進むこと（停止条件にはならず、`/review` → `followup --merge` のチェーン規則にも影響しない）。セッション向け出力のみに留め、Issue コメントとしては投稿しない（Issue / PR / Telegram の言語は英語のまま変更なし）。

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

`fullrun` フローでは、コミット後かつ `pnpm josh followup --merge` 実行前に `/review` スキルを実行する。高・中優先度の指摘が見つかった場合は修正を行い、クリーンになるまで再度 `/review` を実行してから次のステップへ進む。

### `fullrun` STOPPING CONDITIONS — read this before you stop

**`fullrun` / `fullrun new` / `queue` may stop in exactly 2 situations. If neither applies, the chain MUST continue without user input.**

1. **PR is merged, the `completion` Telegram notification has been sent, AND `pnpm josh ms` has returned the working tree to the default branch.** This is the normal end state. The agent reports the PR URL and stops.
2. **A genuine blocker requires user judgment.** Exactly these three count as blockers:
   - A CodeRabbit / Claude Review substantive finding that the agent cannot auto-verify as a false positive (see "Verify CodeRabbit findings before bypassing").
   - The managed config-file confirmation gate (`josh sync`-distributed files in the diff).
   - A CI failure that requires user input to resolve.

   When a blocker fires, the agent MUST send a `confirmation` Telegram **before** stopping (per "Mid-workflow stop notification").

**Everything else — including a `/review` skill returning a polished "Approve for merge" recommendation — is NOT a stopping condition.** The agent continues straight to `pnpm josh followup --merge` in the same turn.

### Chain rule: `/review` → `followup --merge` decision table

The `/review` skill output is a Markdown review with sections, severity-tagged findings, and a final recommendation. **It is an intermediate step, not a turn boundary.** Map the result mechanically:

| `/review` result                        | Severity of findings | Next action (same turn, no user input)                                                                                                                         |
| --------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues` | None                 | Immediately run `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                                                             |
| Findings, but all are Low               | Low only             | Immediately run `pnpm josh followup --merge` (Low findings may be skipped with a one-line reason per Pre-commit Self-Review)                                   |
| One or more High / Medium findings      | High and/or Medium   | Fix in place, re-stage, commit, push, re-run `/review`, loop. Do NOT report the findings narratively to the user and wait. Do NOT call `followup --merge` yet. |
| `/review` itself errors / can't run     | n/a                  | Report the error and stop with a `confirmation` Telegram (treat as a CI-level blocker)                                                                         |

The recommendation line at the bottom of the `/review` output ("Approve for merge", "Request changes", etc.) is **informational, not authoritative**. The severity of findings drives the decision, not the recommendation sentence.

### Anti-pattern catalog (concrete violation phrases — self-recognize these)

If the agent is about to emit text that resembles any of the following, it is violating the chain rule. Cancel the message, run `pnpm josh followup --merge` instead.

- "The `/review` is clean — ready to merge. Shall I proceed with `followup --merge`?"
- "`/review` found no high/medium findings. Approve for merge after you confirm."
- "Recommendation: Approve for merge. Let me know if you'd like me to continue."
- "All green. Awaiting your go-ahead to merge."
- "The review is complete. Should I run `pnpm josh followup --merge` now?"
- Posting the `/review` Markdown output and then stopping the turn without a tool call.
- Listing low-severity findings narratively and asking whether they should block merge (Low findings are auto-skipped with a one-line reason; do not escalate).
- Treating CodeRabbit rate-limit warnings as findings (they are not — proceed).

These all share the same shape: presenting the `/review` outcome to the user and waiting. The user invoked `fullrun`; merging is part of that invocation. **The chain ends at a stopping condition above, never at `/review` output.**

This rule applies regardless of model (Claude / Gemini / Cursor) or account; the workflow is portable and the chain must hold across environments.

### Turn-end self-check (fullrun-conditional) — run BEFORE sending any response that contains `/review` output

The chain rule above has been violated repeatedly even with the decision table and anti-pattern catalog in place (PR #387 on 2026-05-15, PR #398 on 2026-05-20). The rule needs to be visible at the **exact moment of violation** — when the response is about to be sent. Run this check, in order, before sending any response containing `/review` output:

1. **Mode check** — Is this `/review` part of a `fullrun` / `fullrun new` / `queue` invocation? Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) `pnpm josh git -y` has already been run in this session and a PR exists for the current branch (verifiable with `gh pr view <branch>`). If either is false → **standalone mode**; stop after the review markdown, do NOT call `followup --merge`. This conditional prevents auto-merging when the user runs `/review <PR>` standalone for a code-review-only purpose.
2. **Severity check** — Count high/medium findings across all categories. If ≥1 → fix in place, re-stage, commit, push, re-run `/review`. Loop until none remain. Do NOT call `followup --merge` yet.
3. **Append check** — If in fullrun mode AND 0 high/medium findings (Low-only or fully clean) → the same response that contains the `/review` markdown MUST also contain a `pnpm josh followup "<title> #<N>" --merge --notify-message "..."` tool call **after** the review markdown. **A response whose final assistant text is `/review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call before sending.

The check fires at the moment your response would end with review markdown and no follow-on tool call. That is the violation point. Treat the `/review` skill's output as an intermediate tool result, not a deliverable.

This self-check is mirrored at the end of the `/review` skill prompt (`prompts/review.md`) so it is visible inside the skill's own execution context — not just in the always-loaded project docs.

### Tooling enforcement (investigated, not implemented)

A `pnpm josh review --auto-followup` style CLI wrapper was investigated as part of this rule. **It is not feasible at the tooling layer**: `/review` is an interactive AI skill that returns Markdown for the agent to interpret — a shell command cannot host the skill, parse its severity verdicts, or decide "no high/medium" on the agent's behalf. The strongest available enforcement is the decision table, anti-pattern catalog, and turn-end self-check above, sitting in always-loaded context (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`) plus the skill prompt (`prompts/review.md`).

## 報告フォーマット（平易な概要 ＋ 技術詳細）

作業前サマリ（Step 7）と完了報告（Step 5）は、**平易な概要を先頭に置き、技術詳細をその下に降格する 2 層構造**で書く。ここが横断ドキュメント（`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`）のカノニカル参照。

理由: 報告の読み手は実装者とは限らない。ファイル名・型名・オプション名が並ぶ説明は「何が原因で、どう対応し、結果どうなったか」を伝えない。詳細を消すのではなく、**先に結論を平易な言葉で伝え、詳細は読み飛ばせる位置に置く**。

### 作業前サマリ（セッション向け・`JOSH_SESSION_LANG` の言語）

```text
■ これからやること
  今こうなっている: <1文 — 利用者から見て何が起きているか>
  こう直す:         <1文 — 手段ではなく、直った後どうなるか>
  確かめ方:         <1文 — どう確認するか>

--- 技術詳細 ---
<触るファイル / モジュール · アプローチとその理由 · 副作用 / 意図的にスコープ外にした点>

Change 1: <変更内容>
  → Test: <Unit|E2E> — <file path> — <検証する挙動>
Change 2: ...
```

### 完了報告（セッション向け）

```text
■ 完了報告
  原因: <1文 — なぜそうなっていたか>
  対応: <1文 — 何をしたか>
  結果: <1文 — 利用者から見て何が変わったか>（v<version>）

--- 技術詳細 ---
<変更ファイル · テスト結果 · 残課題>
```

### 概要 3 行の書き方（ここが本体）

長さ制限だけでは平易にならない。**語彙と抽象度を制約する**:

- 各行は 1 文・短く（日本語で 60 字程度、英語で 15 語程度）
- 概要にファイルパス・関数名・型名・CLI オプション名を書かない（すべて技術詳細セクション側）
- 専門用語は使わないか、`〜（＝…のこと）` の形でその場で言い換える
- 変更点の羅列ではなく **原因 → 対応 → 効果の因果**で書く
- 主語は利用者・システムの振る舞い。「利用者から見て何が違うか」が書けないなら、その行はまだ技術詳細のまま

**送信前セルフチェック（`/review` チェーン規則の自己チェックと同じ位置づけ）**: 報告を送る直前に概要 3 行を読み返し、ファイル名・記号・英略語が混じっていないか、プログラマでない人が読んで意味が通るかを確認する。混じっていたらその語を技術詳細へ移してから送る。

### 成果物（Issue / PR / Telegram）側

言語ルールは変えない — 成果物は常に英語。**構造だけ**同じ 2 層にする。`--notify-message` は `Added ... / Changed ...` の羅列ではなく、`Cause / Fix / Result` の 3 行を先頭に置き、変更点の箇条書きを `Details:` 以下にまとめる（書式は Step 5 の例を参照）。

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
- `--notify-message`: Issue への完了コメント本文。英語で、「報告フォーマット」の 2 層構造に従う — 先頭に `Cause: / Fix: / Result:` の 3 行（各 1 文、専門用語・ファイル名なし）、続けて `Details:` 以下に変更点の箇条書き。`Added ... / Changed ...` だけの羅列にしない
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

## 別パッケージ起因の問題は割り込み Issue で対応する

作業中（実装・検証・レビュー対応のいずれの段階でも）に新たな課題を発見した場合、**即席対応を優先せず根本的な解決を先に行う**。発見した問題が、実は別パッケージ（依存パッケージや、このプロジェクトが消費している配布元 = kit / `josh` ツールなど）に起因する場合でも同様で、現在のリポジトリ内のローカル回避策（ハック・パッチ・回避コード）で押し切ってはならない。根本原因を **対象パッケージ側** で解決する。

推奨フロー:

1. **現在の作業を退避する**: `git stash`（WIP コミットでも可）。退避したことを忘れないよう、この時点で stash を作る
2. **進行中の Issue に状況を明記する**: `gh issue comment <N> --body "..."` で、(a) 作業を stash したこと、(b) 中断理由（どの別パッケージの・どんな問題で中断したか）、(c) 対象パッケージに作成した新 Issue へのリンク、を記載する。これにより「なぜこの Issue が一時停止しているか」が後から監査できる
3. **対象パッケージのリポジトリに新しい Issue を作成する**: `gh issue create -R <owner>/<repo> --title "<root-cause title>" --body "<root cause and context>"`。根本原因・再現・期待結果を Step 1 のテンプレに沿って記載する
4. **新 Issue を割り込みで対応する**: 必要に応じて別ターンで対象パッケージ側の `fullrun` などを実行する（上流パッケージの実装・PR・マージはそれぞれのワークフロー規則に従う）
5. **元の作業を再開する**: 上流の修正がマージされた（または、ユーザーが先送りを明示判断した）後に `git stash pop` して、退避していた元タスクを続行する

注意:

- 即席回避と割り込み根本対応のどちらを取るか迷う場合は、**根本対応（割り込み Issue）を既定とする**
- 別パッケージへの新 Issue 作成・stash・Issue コメントは可逆かつ低コストな調査/起票操作なので、Tier C（不可逆・共有状態の操作）ではなく、このフローに沿う限り確認なしで進めてよい。ただし上流パッケージの **マージ等の共有状態操作** は通常どおりそれぞれのワークフローの明示起動を要する
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Cross-package problems → interrupt with a new Issue」）のカノニカル参照

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
4. **既存の保護を尊重する**: この方針は `pnpm.overrides` / `devEngines` の承認ゲートを上書きしない。fix-forward は _「最新を優先し破壊を直す」_ であって _「保護された pin を黙って書き換える」_ ではない。`pnpm.overrides` / `devEngines` の変更は従来どおりユーザーの明示承認を要する（→「`pnpm.overrides` の保護」、および CLAUDE.md の `devEngines` 保護ルール参照）
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
- 自動投稿される Issue コメント文面は英語で記載する

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
  2. 承認済みのコミットフローの一部として実行される（`pnpm josh git`、および `fullrun` / `queue` の起動に含まれるコミット手順）
- 上記以外で staging が必要だと考えたときは、**実行せずに先に確認する**
- 同じ理由で、`git reset` / `git checkout -- <path>` / `git restore <path>` など index や作業ツリーを破壊的に書き換える操作も、自分の判断で実行しない
- **`git stash` は例外的に、明文化されたフローの中でのみ自動実行してよい**: `fullrun new` / `halfrun new` の手順 5（作業ツリーに変更がある状態で `josh latest` を回す前の退避）、`queue` の手順 1、および「別パッケージ起因の問題は割り込み Issue で対応する」。いずれも直後に `git stash pop` で復元することが手順に含まれている。これら以外の場面で退避したくなったときは、実行せずに先に確認する
- このルールは横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Git Rules」→「Never stage or mutate the git index on your own」）のカノニカル参照

### 意思決定の自律ポリシー（確認停止を減らす）

AI ツール（Opus / Gemini / Cursor）が判断の分岐で止まりすぎるのを防ぐため、各判断を3層に分類して扱う。停止して確認するのは**本当にユーザーの判断が必要な分岐だけ**にする。このセクションが横断ドキュメント（CLAUDE.md / AGENTS.md / GEMINI.md「Decision autonomy」）のカノニカル参照。

- **Tier A — 可逆な実装・設計判断**（明確に優位な選択肢があるライブラリ選定、命名、ファイル構成、テスト手法、リファクタの形）。メリット比較で1案が明確に優位なら**確認せず自動で選んで進める**。本来ユーザー確認すべき分岐だった場合は、後から監査・差し戻せるよう判断を記録する（下記「自動判断の記録」）
- **Tier B — 本当に甲乙つけがたい判断**。上位2案がどちらも妥当で差が僅差。**ここだけが停止する層** — ユーザーに確認する（`AskUserQuestion` が使えるなら使う）。拮抗する候補とトレードオフを提示する
- **Tier C — 不可逆・共有状態・スコープ外の操作**（マージ、ブランチ削除、force push、破壊的操作、リポジトリ設定変更、タスク範囲外の変更、`devEngines` / `pnpm.overrides` の編集）。**このポリシーの対象外。** 1案が明確に優位に見えても、常にユーザーの明示指示を要する。既存の安全ルール（上記「指示されていない行動は取らない」、`devEngines` / `pnpm.overrides` 保護）が優先される

**A と B の判定基準**: 確認するのは「差が僅差 **かつ** 後戻りしにくい／アーキテクチャに長く影響する」ときだけ。「迷っている」だけでは停止理由にならない — 明確に優位な選択肢は多少の不確実性が残っても自動で選び、僅差でも安価に巻き戻せる選択は自動で決めて記録して進む。

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

### `pnpm.overrides` の保護

`pnpm.overrides`（または `overrides`）に設定された制約は、**セキュリティ・互換性・動作保証のために意図的に追加されたもの**である。

- `pnpm latest` や `pnpm update --latest` 実行後は必ず `pnpm.overrides` が変化していないか確認する
- overrides が自動的に変更・削除された場合は、**理由を調査してから**ユーザーに報告し、明示的な承認なしに変更してはならない
- 例: `"esbuild@<=0.24.2": ">=0.25.0"` などのバージョン制約は、Workers ビルド互換性やパッケージの動作保証のために入れてある場合がある
