# Issue-Driven Collaboration Workflow

複数の AI ツール（Claude / Cursor / Gemini）で共通に使う Issue 駆動ワークフローの**索引**。

## この索引の使い方

人間が読むための索引であり、規則を定める場所ではない。常駐の引き金は `CLAUDE.md`、実行中の手順は `.claude/skills/workflow-commands/`、各話題の規則は下表のファイルが一次情報である。

- 下表から必要な 1 本だけを開く。
- 他の文書から話題を指すときは、索引でなく**本文があるファイルを直接指す**（[`residency.md`](./collaboration-workflow/residency.md)）。

| 話題                                                       | ファイル                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Overview                                                   | [`overview.md`](./collaboration-workflow/overview.md)                     |
| Step 1: Issue 作成テンプレ                                 | [`issue-template.md`](./collaboration-workflow/issue-template.md)         |
| Step 2: 提案依頼（AI 共通）                                | [`proposal-request.md`](./collaboration-workflow/proposal-request.md)     |
| Step 3: 計画コメントの記録と通知                           | [`plan-comment.md`](./collaboration-workflow/plan-comment.md)             |
| 報告フォーマット（平易な概要 ＋ 技術詳細）                 | [`report-format.md`](./collaboration-workflow/report-format.md)           |
| Issue はリンク＋セッション言語の短い要約で参照する         | [`issue-citation.md`](./collaboration-workflow/issue-citation.md)         |
| オープン Issue の WIP 上限                                 | [`wip-cap.md`](./collaboration-workflow/wip-cap.md)                       |
| 別パッケージ起因の問題は割り込み Issue                     | [`upstream-interrupt.md`](./collaboration-workflow/upstream-interrupt.md) |
| 原則 — クローン禁止・シンプル第一・相談と実行・最新優先 等 | [`principles.md`](./collaboration-workflow/principles.md)                 |
| ファイル編集はコマンド本文に本文を載せない                 | [`file-edits.md`](./collaboration-workflow/file-edits.md)                 |
| 本文をシェルの二重引用符に載せない                         | [`shell-body.md`](./collaboration-workflow/shell-body.md)                 |
| 独立した呼び出しは同じターンに載せる                       | [`turn-batching.md`](./collaboration-workflow/turn-batching.md)           |
| `gh` は REST（`gh api`）で書く                             | [`gh-rest.md`](./collaboration-workflow/gh-rest.md)                       |
| 常駐ドキュメントと skill の分担                            | [`residency.md`](./collaboration-workflow/residency.md)                   |
| 引き金つき配送 — 規則を効く瞬間に届ける                    | [`rule-delivery.md`](./collaboration-workflow/rule-delivery.md)           |
| コマンド出力が文脈へ持ち込む量の上限                       | [`output-bounds.md`](./collaboration-workflow/output-bounds.md)           |
| 運用ルール                                                 | [`operating-rules.md`](./collaboration-workflow/operating-rules.md)       |
| 用語集 — lane・cut・hold・park など                        | [`glossary.md`](./collaboration-workflow/glossary.md)                     |
