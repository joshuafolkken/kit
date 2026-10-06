## 別パッケージ起因の問題は割り込み Issue で対応する

作業中（実装・検証・レビュー対応のいずれの段階でも）に新たな課題を発見した場合、**即席対応を優先せず根本的な解決を先に行う**。発見した問題が、実は別パッケージ（依存パッケージや、このプロジェクトが消費している配布元 = kit / `josh` ツールなど）に起因する場合でも同様で、現在のリポジトリ内のローカル回避策（ハック・パッチ・回避コード）で押し切ってはならない。根本原因を **対象パッケージ側** で解決する。

### 無条件ルール: 起票は確認なし、停止は必ず

**この手順に「これは今の作業をブロックするか？」という判定は一切存在しない。** 上流の欠陥は、ブロックするものもしないものも、**発見した時点で**同じ手順を通る。例外はない。判定を置かない理由は `docs/maintainers/upstream-interrupt-rationale.md` → "Why there is no blocking test" にある。

- **トリガーは「発見」であって「ブロックし始めたとき」ではない**
- **起票は Tier A（確認なし）**。起票してよいか、どのリポジトリへ起票するか、いずれもユーザー確認を取らない。対象は first-party に限る（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
- **停止は無条件**。Issue が存在する状態にしてから停止する。上流の修正を待つか先送りするかは、Issue を目の前にしたユーザーが決める
- **`backlogrun` の中では、停止の範囲がセッション全体ではなくその子 Issue に限定される**。起票と回避策の禁止は変わらない。該当の子に `needs-decision` を付けて park し、依存していない他の子へ進む（→ `.claude/skills/workflow-commands/backlogrun-park.md` → "park and continue"）

手順:

1. **現在の作業を退避する**: `git stash push -u -m "upstream-interrupt: paused #<N>"`（WIP コミットでも可）。退避したことを忘れないよう、この時点で stash を作る。メッセージ付きで積むのは、復元をメッセージで特定するため（下記ステップ 5）
2. **進行中の Issue に状況を明記する**: `pnpm josh issue:comment <N> --body-file <path>` で、(a) 作業を stash したこと、(b) 中断理由（どの別パッケージの・どんな問題で中断したか）、(c) 対象パッケージに作成した新 Issue へのリンクを `## Upstream issues` 見出しの下に `owner/repo#N` 形式で、を記載する。これにより「なぜこの Issue が一時停止しているか」と「何を待っているのか」が後から監査できる（→「起票元へのバックリンク」）
3. **対象パッケージのリポジトリに新しい Issue を作成する（確認なし）**: `pnpm josh issue:file "<root-cause title>" --body-file <body-file> --depth <n> --route tier-a --repo <owner>/<repo>`（`route:tier-a` は実装中の Tier A 起票を経路として集計するためのラベル — joshuafolkken/kit#1083）。本文の検査、本文が宣言する分類ラベルの付与、`## Origin` 節の確認、起票先での重複探し、`epic:bundle` はこのコマンドが実行する（`docs/josh-commands-backlog.md` → `josh issue:file`）。分類の単一ソースは `prompts/collaboration-workflow/issue-template.md`。根本原因・再現・期待結果を Step 1 のテンプレに沿って記載し、**本文に `## Origin` 節を置いて起票元 Issue を `owner/repo#N` 形式で書く**（→「起票元へのバックリンク」）。ここで「起票してよいか」を尋ねて停止してはならない
4. **`confirmation` Telegram を送って停止する**: 上流 Issue の URL と、何が止まっているかを本文に書く（→ `CLAUDE.md` → "Mid-workflow stop notification (`confirmation`)"）。無人実行でも画面外でユーザーが気付ける。停止は Issue が既に存在する状態で行うので、ユーザーは「待つ / 先送りする」を Issue を見ながら 1 語で答えられる
5. **元の作業を再開する**: 上流の修正がマージされた、または**ユーザーが先送りを明示判断した**後に `pnpm josh stash:pop "upstream-interrupt: paused #<N>"`（位置指定や引数なしの `git stash pop` は使わない — stash は全 work tree が共有する 1 本のスタックで、別のレーンの stash を取り込む恐れがある）して、退避していた元タスクを続行する。上流 Issue を割り込みで実装するかどうかもユーザーの判断（上流パッケージの実装・PR・マージはそれぞれのワークフロー規則に従う）

### 第三者リポジトリへの書き込みは Tier C（明示指示が必要）

上の「起票は確認なし」は **first-party**（`pnpm josh repo:party` が `first-party` と答えるリポジトリ）だけに成り立つ。**自分たちが所有しないリポジトリへの書き込みは、これとは別物**として扱う。

- **判定は機械的に行い、判断に委ねない**: `pnpm josh repo:party [<owner/repo>]` が `first-party` / `third-party` / `unknown` の 1 語で答える（対象リポジトリの owner がセッションのリポジトリの owner と一致すれば **first-party**、owner を読めなければ **unknown** で third-party 扱いはしない）。**それ以外は全て third-party** で、fork も、単に contribute しているだけの org リポジトリも third-party に入る
- **first-party は従来どおり**: Tier A。確認なしで起票し、双方向バックリンクを書き、停止する
- **third-party は書き込みの種別を問わず Tier C**: Issue・コメント・PR・Discussion・レビューのいずれも、**その turn におけるユーザーの明示指示**なしに行ってはならない。公開は外向きかつ実質不可逆である（`docs/maintainers/upstream-interrupt-rationale.md` → "Why third-party writes are Tier C"）
- **third-party だと判明したときの手順**: (1) **自分たちの側の Issue** に証拠込みで所見を記録する。見出しは `## Upstream candidate` を使い、`## Upstream issues` は使わない（後者は「起票済み」を主張する見出しであるため）。(2) 報告本文の下書きをその Issue 内に用意し、ユーザーが 1 メッセージで承認できる状態にする。(3) 対象プロジェクト名と報告しようとしている内容を書いた `confirmation` Telegram を送って**停止する**
- **third-party 報告の証拠バー**（下書きを提示する前に満たす）:
  - **自プロジェクトの外で成立する最小再現**（対象の依存だけを入れた素の scaffold）。用意できない場合は「プロジェクト組み込みの再現しかない」ことを下書きに明記する
  - **本文の全主張が検証済み**であること。推測を事実として書かない
  - 同じ欠陥を扱う**既存 Issue の検索**
- **取り下げも外向きの行為**: 既に起票した third-party Issue のクローズ・編集・コメントも、同じく明示指示を要する
- **正しい診断は公開の許可ではない**。所見の正しさは、この節のどの要求も免除しない（事例: `docs/maintainers/upstream-interrupt-rationale.md` → "Why a correct diagnosis is not authorization"）

### 検証ゲートを緩めることも「回避策」である

ローカルに回避コードを書くことだけが違反ではない。**上流の欠陥に合わせて `lint` / `tsc` / `cspell` / unit / E2E の出力を絞り込む・狭める・読み替える行為も、ローカルパッチを書くのと同じ違反**であり、同じ停止を引き起こす。

- 典型例: 上流が配布する設定によって生成されるディレクトリ由来の型エラーを除外し、「プロジェクトソースはエラー 0」として完了ゲートを通過したことにする
- **絞り込んだことを正直に開示しても、ルールを満たしたことにはならない**。完了報告の読者は「緑ではない型チェック」を緑として受け取る
- 検証ゲートは上流の欠陥に合わせて調整しない。**調整したくなった時点が、このルールの発火点**である

注意:

- **即席回避と根本対応は「迷って選ぶもの」ではない**。上流起因と分かった時点で選択肢は根本対応だけであり、「今回は軽いから即席で」という判断はこの手順に存在しない
- 上流パッケージの **マージ等の共有状態操作** は、起票と違って Tier A ではない。通常どおりそれぞれのワークフローの明示起動を要する
- このルールは横断ドキュメント（CLAUDE.md「Cross-package problems → file the upstream Issue, then stop」）のカノニカル参照
