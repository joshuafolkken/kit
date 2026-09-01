# Issue-Driven Collaboration Workflow

<!-- cspell:words coderabbit -->

このドキュメントは、Claude / Cursor / Gemini を含む複数の AI ツールで共通に使う Issue 駆動の共同作業ワークフローの**正典**である。

## この索引の使い方

**これは人間が読むための正典であり、実行中の参照先ではない。** 実行中の操作手順は `.claude/skills/workflow-commands/` にあり、規則そのものは `CLAUDE.md` にある。両者とこの正典は一致していなければならない。実行中にこの正典を開く必要があるのは、skill と規則の言い分が食い違ったときだけである。

**話題ごとにファイルが分かれている。** 以前はこの内容が 1 本の 169KB のファイルにあり、1 つの節を確かめるだけでも全体を読む必要があった。読んだものはそのセッションの残り全ターンで積み上がった前置きとして課金され続けるため、確認 1 回の費用が会話の長さに比例して効いていた（joshuafolkken/kit#965）。**必要な 1 本だけを開くこと。この索引を入口に、下の表から選ぶ。**

| 話題                                                                           | ファイル                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Overview                                                                       | [`overview.md`](./collaboration-workflow/overview.md)                                   |
| Step 1: Issue 作成テンプレ                                                     | [`issue-template.md`](./collaboration-workflow/issue-template.md)                       |
| Step 2: 提案依頼（AI 共通）                                                    | [`proposal-request.md`](./collaboration-workflow/proposal-request.md)                   |
| Step 3: 計画コメントを記録して通知する                                         | [`plan-comment.md`](./collaboration-workflow/plan-comment.md)                           |
| 報告フォーマット（平易な概要 ＋ 技術詳細）                                     | [`report-format.md`](./collaboration-workflow/report-format.md)                         |
| Step 5: PR結果確認 + 完了通知（別スクリプト）                                  | [`completion-notify.md`](./collaboration-workflow/completion-notify.md)                 |
| 後から関連が判明した Issue を epic に束ねる                                    | [`epic-bundle.md`](./collaboration-workflow/epic-bundle.md)                             |
| `into <target>` — 作った Issue をその場で EPIC へ入れる                        | [`into-epic.md`](./collaboration-workflow/into-epic.md)                                 |
| `owner/repo#` — 対象リポジトリを入口で指定する                                 | [`target-repo.md`](./collaboration-workflow/target-repo.md)                             |
| 分割判定は全入口で共通（`kickoff epic` は作らない）                            | [`split-assessment.md`](./collaboration-workflow/split-assessment.md)                   |
| 実行中に前提 Issue が判明した場合                                              | [`prerequisite-issue.md`](./collaboration-workflow/prerequisite-issue.md)               |
| リポジトリをまたぐ EPIC                                                        | [`cross-repo-epic.md`](./collaboration-workflow/cross-repo-epic.md)                     |
| `josh epic:plan` — EPIC の判断を計画段階に前倒しする                           | [`epic-plan.md`](./collaboration-workflow/epic-plan.md)                                 |
| `josh epic:audit` — 子 Issue 群を横断して矛盾を検出する                        | [`epic-audit.md`](./collaboration-workflow/epic-audit.md)                               |
| `epicrun` — EPIC 配下の子 Issue を無人で実行する                               | [`epicrun.md`](./collaboration-workflow/epicrun.md)                                     |
| 別パッケージ起因の問題は割り込み Issue で対応する                              | [`upstream-interrupt.md`](./collaboration-workflow/upstream-interrupt.md)               |
| クローン禁止・単一ソース化（パッケージ境界を越えても）                         | [`no-clones.md`](./collaboration-workflow/no-clones.md)                                 |
| 相談と実行を区別する（議論中にファイルを編集しない）                           | [`consultation-vs-execution.md`](./collaboration-workflow/consultation-vs-execution.md) |
| 配布ドキュメント・設定の変更は kit に上流化する                                | [`distributed-docs.md`](./collaboration-workflow/distributed-docs.md)                   |
| エージェント規則の単一ソースは `CLAUDE.md`（`AGENTS.md` / `GEMINI.md` は導線） | [`single-source-rules.md`](./collaboration-workflow/single-source-rules.md)             |
| 最新優先・fix-forward（pin-back は最終手段）                                   | [`latest-first.md`](./collaboration-workflow/latest-first.md)                           |
| 恒久ルールは MEMORY ではなくプロンプト／ドキュメントに書く                     | [`durable-rules.md`](./collaboration-workflow/durable-rules.md)                         |
| ファイル編集はコマンド本文に本文を載せない                                     | [`file-edits.md`](./collaboration-workflow/file-edits.md)                               |
| 委譲 — 機械的な工程を安価な実行単位へ回す                                      | [`delegation.md`](./collaboration-workflow/delegation.md)                               |
| `josh eval` をいつ回すか（配布物の変更を測る）                                 | [`eval-gate.md`](./collaboration-workflow/eval-gate.md)                                 |
| 常駐ドキュメントと skill の分担（何を常駐に残すか）                            | [`residency.md`](./collaboration-workflow/residency.md)                                 |
| `needs-human-review` — 成果物を人が見るまで出荷させない                        | [`human-review-label.md`](./collaboration-workflow/human-review-label.md)               |
| 運用ルール                                                                     | [`operating-rules.md`](./collaboration-workflow/operating-rules.md)                     |

**どの 1 本を開けばよいかを決めるのに必要なのは、この索引だけである。** バイト数はここに書かない — 手で保守した数字は本文より先に古くなり、古い数字は無いより悪い。実サイズは `ls -l prompts/collaboration-workflow/` が答える。

## 参照の書き方

`CLAUDE.md` と `.claude/skills/` からこの正典を指すときは、**本文があるファイルを直接指す**（話題ファイル、skill へ単一ソース化済みならその skill。[`residency.md`](./collaboration-workflow/residency.md)）。索引や指し先を経由させる形（`prompts/collaboration-workflow.md` → 「節名」）は、読み手に 2 回読みを強いるうえ、節名が変わると黙って行き止まりになる。

```md
See `prompts/collaboration-workflow/upstream-interrupt.md`.
```

`scripts/collaboration-prompt-split.test.ts` が、文書と skill が指すファイルの実在と、この索引が全ファイルを列挙していることを検査する。
