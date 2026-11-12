## Overview

`kickoff` / `fullrun` / `halfrun` / `prrun` / `backlogrun` の手順は `workflow-commands` skill。

### 出力の言語（`JOSH_SESSION_LANG`）

開発者との対話と成果物の散文は、環境変数 `JOSH_SESSION_LANG`（例: `ja` / `en`）の言語で書く。**未設定・空・`.env` なしのときは `ja`**。

- 対話: セッション中の説明・質問、`AskUserQuestion` の選択肢ラベル・説明
- 成果物の散文: Issue 本文、Issue／PR コメント（計画コメント、`pnpm josh followup` の完了コメントを含む）、Telegram 通知の本文（`--body` / `--notify-message`）
- 設定に関わらず英語で固定するもの:
  1. Issue／PR タイトル
  2. コード内コメント、テストタイトル（`describe` / `it` / `expect`）、コミットメッセージ
  3. スクリプトが出力する固定文字列: Telegram のヘッダーラベル（`Planning` / `Completion` など）、`Issue:` / `PR:` の URL ラベル、`--notify-message` 省略時の既定メッセージ
- Issue 本文の見出し・宣言キー・固定値 → josh は設定の言語で書き出し、読み取りは日英どちらも受け付ける（`scripts/issue/issue-body-keys.ts`）
- 文書が日本語で名指すキー・固定値・見出し → `JOSH_SESSION_LANG` の列で書く（対応表は `issue-template.en.md`）

`JOSH_SESSION_LANG` は `.env`（gitignore 済み）に置く。フックが走らないハーネスは `.env` を読む。

### 配布ドキュメントの層ごとの言語（joshuafolkken/kit#2997）

ドキュメントは**層ごとに 1 つの言語**で書き、層の中で言語を混ぜない（`JOSH_SESSION_LANG` に依らない）。

- 英語: `CLAUDE.md`、`AGENTS.md` / `GEMINI.md`、スキル（`.claude/skills/`）、フックが差し込む文、`prompts/review.md`、`prompts/review-rubric.md`、`prompts/sonar-hotspot-handling.md`、`prompts/collaboration-workflow/issue-template.en.md`
- 日本語: それ以外の `prompts/` のトピックファイル

英語の層から日本語のトピックファイルの節を指すときは、見出しの先頭の**英語 ID** を引く（例: `## no-clones — クローン禁止・…` を `principles.md` → "no-clones"。`pnpm josh doc:section` は前方一致で解決する）。ID の無い日本語見出しは原文のまま引く。
