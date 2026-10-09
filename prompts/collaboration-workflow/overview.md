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

### 出力の言語（`JOSH_SESSION_LANG`）

ワークフローの出力言語は、環境変数 `JOSH_SESSION_LANG`（例: `ja` / `en`）で決まる。対象は「開発者との対話」と「成果物の散文」の**両方**であり、**変数が未設定・空・`.env` なしのときはどちらも `ja` を既定とする**。英語で書くなら `JOSH_SESSION_LANG=en` を設定する。

- **対話は `JOSH_SESSION_LANG` に従う**: セッション中の説明・質問、および `halfrun` などで提示する **`AskUserQuestion` の選択肢ラベル・説明**。
- **成果物の散文も `JOSH_SESSION_LANG` に従う**: Issue 本文、Issue／PR コメント（Step 3 の計画コメント、`pnpm josh followup` が自動投稿する完了コメントを含む）、Telegram 通知の本文（`--body` / `--notify-message`）。
- **設定に関わらず英語で固定するもの**（3 つ）:
  1. **Issue／PR タイトル**: Step 1 のタイトル正規化ルールは変更しない。
  2. **コード内コメント、テストタイトル（`describe` / `it` / `expect`）、コミットメッセージ**。
  3. **スクリプトが出力する固定文字列**: Telegram のヘッダーラベル（`Planning` / `Completion` など）、`Issue:` / `PR:` の URL ラベル、`--notify-message` 省略時の既定メッセージ。

`JOSH_SESSION_LANG` は **開発者個人の設定**であり、`.env`（gitignore 済み・非コミット）に置く。**設定値は毎ターン `UserPromptSubmit` フック（`scripts/hooks/run-hook.sh session-lang`）が差し込み、未設定なら出さない。** Codex も `.codex/hooks.json` で同じフックを実行する。フックが走らないハーネス（Gemini / Cursor）は `.env` を読む。各既定の理由は `docs/maintainers/overview-rationale.md` → "Why the session language defaults the way it does" にある。

### 配布ドキュメントの層ごとの言語（joshuafolkken/kit#2997）

ドキュメントは**層ごとに 1 つの言語**で書き、1 つの層の中で言語を混ぜない。`JOSH_SESSION_LANG` はこれを変えない。

| 層                                                                                      | 言語   |
| --------------------------------------------------------------------------------------- | ------ |
| `CLAUDE.md`、`AGENTS.md` / `GEMINI.md`、スキル（`.claude/skills/`）、フックが差し込む文 | 英語   |
| `prompts/` のトピックファイル（次の行の 3 文書を除く）                                  | 日本語 |
| `prompts/review.md`、`prompts/review-rubric.md`、`prompts/sonar-hotspot-handling.md`    | 英語   |

英語の層から日本語のトピックファイルの節を指すポインターは、見出しの先頭に置いた**英語 ID** を引く（例: 見出し `## no-clones — クローン禁止・…` を `principles.md` → "no-clones" で指す）。`pnpm josh doc:section` は見出しの前方一致で節を引くので、ID だけで解決し、`JOSH_SESSION_LANG=en` の利用者や日本語を読まないエージェントにも参照先が読める。ID の無い日本語見出しは原文のまま引く。
