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
   pnpm josh telegram-test --task-type planning --issue-url "<issue-url>" --body "- <bullet1>\n- <bullet2>"
   ```

   - `--task-type` はヘッダーのアイコンを決める（`planning` 📋 / `completion` ✅ / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️）
   - `--repo-name` と `--issue-title` は未指定なら `gh` から自動取得される
   - Issue URL を必ず含める
   - 箇条書きの間に改行を入れて読みやすくする
   - `kickoff` コマンドの場合はここで **停止** する（実装に進まない）

4. メインブランチへ切り替えて最新を取得する:
   ```bash
   git switch main && git pull
   ```
5. 依存関係を最新化し、脆弱性を確認する（`pnpm latest` は内部で `pnpm audit` も実行する）:
   ```bash
   pnpm latest
   # 脆弱性が見つかった場合: package.json の overrides に対象バージョンを追加して pnpm install 後に再確認
   ```
6. 実装を開始する
7. 実装完了後、**lint/test より前に** `prompts/refactoring.md` に従ってリファクタリングを適用する（高・中優先度項目が残らなくなるまで収束させる）
8. 検証ゲート（`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` の Completion gate）を実行する

`pnpm josh git` の基本実行（`-y` で確認プロンプトをスキップ）。**初回コミット前に必ず `pnpm josh bump-version minor` を実行する。** ただし、同一 PR 内の追加修正コミット（CodeRabbit 指摘対応など）では実行しない。

```bash
pnpm josh bump-version minor
pnpm josh git -y "<issue-title> #<issue-number>"
```

> **Note**: Issue タイトルは `pnpm josh git` を実行する前に、簡潔で明瞭な英語に整えること。
> 日本語で書かれている場合は英語に変換する。すでに英語で書かれている場合でも、文法・明確さ・簡潔さの観点で改善できるなら書き換えて良い（AI ツールは実装前にタイトル品質を判断する）。
> いずれの場合も `gh issue edit <number> --title "<english-title>"` で GitHub Issue タイトルを合わせて更新する。

## Step 5: PR結果確認 + 完了通知（別スクリプト）

`pnpm josh git` の後に、別スクリプト `pnpm josh git-followup` を実行する。

`pnpm josh git-followup` の主な動作:

- Cloudflare / CodeRabbit / SonarQube の結果確認（Required チェックのみ待機。CodeQL 等の non-required チェックは待たない）
- CodeRabbit 指摘の未対応検出（必要なら理由コメント投稿）
- AI レビューコメントのスキャン（Claude Review / CodeRabbit サマリコメント）。CI ステータスとは独立に実行する。ブロッカー該当コメントが残っている場合は `confirmation` Telegram 通知を送り非ゼロ終了する（`--ai-review-ignore-reason` を渡した場合のみ PR にスキップ理由コメントを投稿して続行）
- Issue への完了通知投稿（Issue body が空なら body を編集、既にあればコメント追加）
- Telegram 通知: 成功時のみ `task_type=completion`（✅）を自動送信する。CI 失敗や例外は単に再スローされるだけで、Telegram 通知は出さない。**`completion` 通知は必ずこの自動送信経路を使うこと。`pnpm josh telegram-test --task-type completion ...` を手動で呼び出してはならない**（詳細は下記「`completion` 通知は `pnpm josh git-followup` 経由のみ」を参照）
- 失敗の Telegram 通知は AI ツールが **最終的に復旧を諦めた** と判断したときに限り、手動で 1 回だけ送る: `pnpm josh telegram-test --task-type failure --issue-url "<issue-url>" --body "<理由と未解決点>"`（再試行ごとに送らない）

主なオプション:

- `--notify-target`: `issue`（固定。PR への完了報告は行わない）
- `--notify-message`: Issue への完了コメント本文。定型文ではなく実装内容のサマリーを英語で記載する（例: `"Implemented X:\n- Added ...\n- Changed ..."`）
- `--coderabbit-ignore-reason`: 未対応を残す場合の理由コメント
- `--ai-review-ignore-reason`: AI レビュー（Claude Review / CodeRabbit サマリ）の未対応ブロッカーを残す場合の理由コメント
- `--issue-number`: Issue 番号（または位置引数に `"<title> #<number>"`）

例1: 基本（`fullrun` ではマージも込み）

```bash
pnpm josh git-followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>:
- Added ...
- Changed ..."
```

例2: CodeRabbit 未対応理由あり

```bash
pnpm josh git-followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>:
- Added ...
- Fixed ..." \
  --coderabbit-ignore-reason "仕様上この指摘は該当しないため"
```

例3: AI レビュー（Claude Review）の未対応ブロッカー理由あり

```bash
pnpm josh git-followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>:
- Added ...
- Fixed ..." \
  --ai-review-ignore-reason "該当指摘は別 Issue #123 で追跡中のため"
```

例4: マージなし（`kickoff` 後や手動マージが必要な場合）

```bash
pnpm josh git-followup "<issue-title> #<issue-number>" \
  --notify-message "Implemented <title>:
- Added ..."
```

### AI レビューコメントのスキャン（Claude Review / CodeRabbit サマリ）

`pnpm josh git-followup` は CI 完了後、`gh pr view <branch> --json comments` で取得した PR のトップレベルコメントをスキャンし、AI レビュアーが残した未対応の指摘を検出する。**CI がオールグリーンでも、AI レビュアーのブロッカー指摘が残っていれば完了しない**。

- ブロッカー判定ヒューリスティック（保守的・構造ベース／NLP は使わない）:
  - **Claude Review**（`author.login = claude`）: 本文に `### Issues` / `### Problem` / `#### Logic bug` / `### 1. ...` などの番号付き指摘見出しを含む
  - **CodeRabbit**（`author.login = coderabbitai` / `coderabbitai[bot]`）: 本文に `Actionable comments posted: N` を含み `N > 0`。レート制限通知（`rate limited by coderabbit.ai` / `Rate limit exceeded`）や `No actionable comments` は無視する
- ブロッカーが残っていて `--ai-review-ignore-reason` が未指定の場合: `confirmation` Telegram 通知を送り、非ゼロで終了する。指摘を修正してから再実行するか、意図的に無視する理由を渡す
- `--ai-review-ignore-reason "<reason>"` を渡した場合: 無視理由コメントを PR に投稿したうえで完了通知まで進める（`--coderabbit-ignore-reason` と同じ流れ）

## 運用ルール

- 通知は CI チェック成功後に投稿する
- 通知投稿に失敗しても、実装完了の事実はログで確認できるようにする
- 自動投稿される Issue コメント文面は英語で記載する

### CI チェック失敗時の対応

`pnpm josh git-followup` は Required チェックのみ待機するが、**Workers Builds（Cloudflare デプロイ）など非 Required チェックが失敗した場合も必ずユーザーに明示的に報告する**。

- `gh pr checks` の結果を確認し、失敗しているチェックがあればすべて列挙する
- 修正できた場合: 修正内容を `--notify-message` に含める
- 修正できなかった場合: `--notify-message` に失敗チェック名・原因・未解決である旨を記載する。**完了コメントに失敗を隠してはならない**
- ユーザーへの報告も失敗の事実を正直に伝える（「成功」として扱わない）

### Auto-merge（default for `fullrun`）

`fullrun` / `fullrun new` の既定動作として、`pnpm josh git-followup --merge` が CI 待機・AI レビュー確認・完了通知・マージをまとめて行う。ユーザーが `fullrun` を実行した時点で、マージまで含めて承認されたものとみなす（追加キーワードは不要）。

```bash
pnpm josh git-followup "<title> #<N>" --merge --notify-message "..."
```

- **AI レビュー指摘は自動チェック**: `pnpm josh git-followup --merge` は CI グリーン後に AI レビュアーの指摘をスキャンする。ブロッカーが残っていれば `confirmation` 通知を送って非ゼロで終了する（マージされない）。指摘を修正して `pnpm josh git-followup --merge` を再実行する。**CI がオールグリーンでも、未対応の AI レビュー指摘があるならマージしない**
- **CodeRabbit のレート制限はマージを止めない**: CodeRabbit のコメントが rate limit 警告のみ（本文に `rate limited by coderabbit.ai` または `Rate limit exceeded` を含む）で実体のあるレビューが無い場合、または最新 commit に対して CodeRabbit のコメントが一切無い場合は、**レート制限切れとみなしてマージへ進む**
- **マージ戦略**: 内部で `gh pr merge <branch> --merge` を実行する。既定は `--merge`（merge commit）。リポジトリが `allow_squash_merge` / `allow_rebase_merge` のみを許可している場合はそれに合わせる（`gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` で確認）
- **ブランチ削除**: `--delete-branch` は既定で付けない。ブランチ削除は別途ユーザーが指示する
- **失敗時の対応**: branch protection 未達・コンフリクトなどでマージが拒否された場合は、原因を報告して停止する。フラグを変えて再試行したり保護をバイパスしたりしない
- **マージをスキップしたい場合**: `--merge` フラグを省いて `pnpm josh git-followup` を実行するか、`kickoff`（planning のみ）を使うか、同じターンで明示的に "do not merge" と伝える。`fullrun` の外では勝手に `gh pr merge` を実行してはならない

### 指示されていない行動は取らない

PR マージ・ブランチ削除・force push・共有ブランチへの push・外部通知の追加送信・リポジトリ設定の変更など、**共有状態に影響する操作はその場でユーザーに明示指示されたものだけ実行する**。

- `fullrun` の auto-merge は上記のとおり `fullrun` の指示自体に含まれるため許可される。それ以外の状況で勝手にマージしてはならない
- `kickoff` / `pnpm josh git-followup` 単独実行は文書化されたスコープで終了する。PR が OPEN のまま完了したら状態を報告して停止する
- 「チェックが全部 green だから次のステップに進む」は承認ではない
- 迷ったら確認する。確認のコストは低いが、意図しない操作の巻き戻しは高コスト

### `completion` 通知は `pnpm josh git-followup` 経由のみ

`task_type=completion`（✅）の Telegram 通知は `pnpm josh git-followup` が自動送信する経路のみを使う。`pnpm josh telegram-test --task-type completion ...` を手動で実行してはならない。

- 理由: 手動 CLI では `--pr-url` を明示しない限り PR URL が欠落する。`pnpm josh git-followup` は内部で `gh pr view <branch> --json url` から PR URL を取得して必ず付与するため、通知から PR リンクが消える事故を防げる
- 初回 PR 作成時・フォローアップコミット（CodeRabbit 指摘対応や再レビュー対応）・ブランチ再 push のいずれでも、完了を通知したいときは `pnpm josh git-followup "<title> #<issue-number>" --merge --notify-message "Implemented <title>:\n- <change1>\n- <change2>\n..."` を再実行する（通知はマージ直前に送られる）
- `pnpm josh telegram-test` は `planning` / `confirmation` / `kickoff_retry` / `failure` の 4 タスクタイプ専用。`completion` には使わない

### 確認待ちで停止するときの Telegram 通知（`confirmation`）

`kickoff` / `fullrun` 実行中に AI ツールがユーザーの確認・承認・指示待ちで停止するときは、停止の **直前に** Telegram 通知を 1 回送る。これにより、画面を見ていなくてもユーザーが応答すべきタイミングに気付ける。

```bash
pnpm josh telegram-test --task-type confirmation --issue-url "<issue-url>" --body=$'<停止理由>\n<ユーザーに求める判断>'
```

- 本文が `-` で始まる場合は `--body=...` の形式（1 トークン）で渡す。スペース区切りでは `parseArgs` がエラーになる
- 同一の停止に対して通知は 1 回のみ。再評価のたびに送らない
- ユーザー自身がそのターンで停止を指示した場合は通知しない（既に把握しているため）

### `pnpm.overrides` の保護

`pnpm.overrides`（または `overrides`）に設定された制約は、**セキュリティ・互換性・動作保証のために意図的に追加されたもの**である。

- `pnpm latest` や `pnpm update --latest` 実行後は必ず `pnpm.overrides` が変化していないか確認する
- overrides が自動的に変更・削除された場合は、**理由を調査してから**ユーザーに報告し、明示的な承認なしに変更してはならない
- 例: `"esbuild@<=0.24.2": ">=0.25.0"` などのバージョン制約は、Workers ビルド互換性やパッケージの動作保証のために入れてある場合がある
