# Issue-Driven Collaboration Workflow

<!-- cspell:words coderabbit -->

このドキュメントは、Claude / Cursor / Gemini を含む複数の AI ツールで共通に使う Issue 駆動の共同作業ワークフローの**索引**である。

## この索引の使い方

**これは人間が読むための索引であり、規則を定める場所ではない。** 常駐の引き金は `CLAUDE.md` に、実行中の操作手順は `.claude/skills/workflow-commands/` に、各話題の規則は下の表のファイルにあり、それぞれが自分の規則の一次情報である。この索引はそれらを言い直さない。

**話題ごとにファイルが分かれている。** 以前はこの内容が 1 本の 169KB のファイルにあり、1 つの節を確かめるだけでも全体を読む必要があった。読んだものはそのセッションの残り全ターンで積み上がった前置きとして課金され続けるため、確認 1 回の費用が会話の長さに比例して効いていた（joshuafolkken/kit#965）。**必要な 1 本だけを開くこと。この索引を入口に、下の表から選ぶ。**

| 話題                                                                                              | ファイル                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Overview                                                                                          | [`overview.md`](./collaboration-workflow/overview.md)                     |
| Step 1: Issue 作成テンプレ                                                                        | [`issue-template.md`](./collaboration-workflow/issue-template.md)         |
| Step 2: 提案依頼（AI 共通）                                                                       | [`proposal-request.md`](./collaboration-workflow/proposal-request.md)     |
| Step 3: 計画コメントを記録して通知する                                                            | [`plan-comment.md`](./collaboration-workflow/plan-comment.md)             |
| 報告フォーマット（平易な概要 ＋ 技術詳細）                                                        | [`report-format.md`](./collaboration-workflow/report-format.md)           |
| セッション向け出力で Issue はリンク＋セッション言語の短い要約で参照する                           | [`issue-citation.md`](./collaboration-workflow/issue-citation.md)         |
| オープン Issue の WIP 上限                                                                        | [`wip-cap.md`](./collaboration-workflow/wip-cap.md)                       |
| 別パッケージ起因の問題は割り込み Issue で対応する                                                 | [`upstream-interrupt.md`](./collaboration-workflow/upstream-interrupt.md) |
| 原則 — クローン禁止・シンプル第一・相談と実行の区別・最新優先・恒久ルールと配布物と規則の置き場所 | [`principles.md`](./collaboration-workflow/principles.md)                 |
| ファイル編集はコマンド本文に本文を載せない                                                        | [`file-edits.md`](./collaboration-workflow/file-edits.md)                 |
| 本文をシェルの二重引用符に載せない                                                                | [`shell-body.md`](./collaboration-workflow/shell-body.md)                 |
| 独立した呼び出しは同じターンに載せる                                                              | [`turn-batching.md`](./collaboration-workflow/turn-batching.md)           |
| `gh` は REST（`gh api`）で書く — 散文の指示も含む                                                 | [`gh-rest.md`](./collaboration-workflow/gh-rest.md)                       |
| 常駐ドキュメントと skill の分担（何を常駐に残すか）                                               | [`residency.md`](./collaboration-workflow/residency.md)                   |
| 引き金つき配送 — 規則を効く瞬間に届ける                                                           | [`rule-delivery.md`](./collaboration-workflow/rule-delivery.md)           |
| コマンド出力が文脈へ持ち込む量の上限                                                              | [`output-bounds.md`](./collaboration-workflow/output-bounds.md)           |
| 運用ルール                                                                                        | [`operating-rules.md`](./collaboration-workflow/operating-rules.md)       |

**どの 1 本を開けばよいかを決めるのに必要なのは、この索引だけである。** バイト数はここに書かない — 手で保守した数字は本文より先に古くなり、古い数字は無いより悪い。実サイズは `ls -l prompts/collaboration-workflow/` が答える。

## 参照の書き方

`CLAUDE.md` と `.claude/skills/` からこれらの話題を指すときは、**本文があるファイルを直接指す**（話題ファイル、skill へ単一ソース化済みならその skill。[`residency.md`](./collaboration-workflow/residency.md)）。索引や指し先を経由させる形（`prompts/collaboration-workflow.md` → 「節名」）は、読み手に 2 回読みを強いるうえ、節名が変わると黙って行き止まりになる。

```md
See `prompts/collaboration-workflow/upstream-interrupt.md`.
```

`scripts/claude/collaboration-prompt-split.test.ts` が、文書と skill が指すファイルの実在と、この索引が全ファイルを列挙していることを検査する。
