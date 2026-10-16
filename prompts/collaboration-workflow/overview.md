## Overview

1. Issue を作成する
2. Issue を元に実装提案を作る
3. 計画コメントを Issue に残して Telegram 通知を送る
4. 実装を進める
5. 実装完了後に Issue へ完了コメントを投稿する

### フェーズ分離

- Planning phase（`kickoff`）: Step 1〜3 — Issue 作成・計画投稿・Telegram 通知で止まる。実装前にレビューや承認を挟むときに使う。
- Execution phase（`fullrun #N`）: Step 4〜5 — 既存 Issue の計画に基づいて実装・PR 作成・完了通知を行う。

`fullrun new` は Step 1〜5 を通しで実行する。

### 出力の言語（`JOSH_SESSION_LANG`）

開発者との対話と成果物の散文は、環境変数 `JOSH_SESSION_LANG`（例: `ja` / `en`）の言語で書く。**未設定・空・`.env` なしのときは `ja`**。

- 対話: セッション中の説明・質問、`AskUserQuestion` の選択肢ラベル・説明
- 成果物の散文: Issue 本文、Issue／PR コメント（Step 3 の計画コメント、`pnpm josh followup` の完了コメントを含む）、Telegram 通知の本文（`--body` / `--notify-message`）
- **設定に関わらず英語で固定するもの**（3 つ）:
  1. Issue／PR タイトル（Step 1 のタイトル正規化ルール）
  2. コード内コメント、テストタイトル（`describe` / `it` / `expect`）、コミットメッセージ
  3. スクリプトが出力する固定文字列: Telegram のヘッダーラベル（`Planning` / `Completion` など）、`Issue:` / `PR:` の URL ラベル、`--notify-message` 省略時の既定メッセージ

`JOSH_SESSION_LANG` は開発者個人の設定で、`.env`（gitignore 済み）に置く。設定値は毎ターン `UserPromptSubmit` フック（`scripts/hooks/run-hook.sh session-lang`、Codex は `.codex/hooks.json`）が差し込み、未設定なら出さない。フックが走らないハーネス（Gemini / Cursor）は `.env` を読む。

### 配布ドキュメントの層ごとの言語（joshuafolkken/kit#2997）

ドキュメントは**層ごとに 1 つの言語**で書き、層の中で言語を混ぜない（`JOSH_SESSION_LANG` に依らない）。

- 英語: `CLAUDE.md`、`AGENTS.md` / `GEMINI.md`、スキル（`.claude/skills/`）、フックが差し込む文、`prompts/review.md`、`prompts/review-rubric.md`、`prompts/sonar-hotspot-handling.md`
- 日本語: それ以外の `prompts/` のトピックファイル

英語の層から日本語のトピックファイルの節を指すときは、見出しの先頭の**英語 ID** を引く（例: `## no-clones — クローン禁止・…` を `principles.md` → "no-clones"。`pnpm josh doc:section` は前方一致で解決する）。ID の無い日本語見出しは原文のまま引く。
