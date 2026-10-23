## 別パッケージ起因の問題は割り込み Issue で対応する

作業中（実装・検証・レビュー対応のどの段階でも）に見つけた問題が別パッケージ（依存パッケージ、配布元の kit / `josh` ツールなど）に起因するとき、現在のリポジトリ内のローカル回避策（ハック・パッチ・回避コード）で押し切らず、**根本原因を対象パッケージ側で解決する**。`CLAUDE.md` → "Cross-package problems → file the upstream Issue, then stop" の本体。

### 無条件ルール: 起票は確認なし、停止は必ず

**「今の作業をブロックするか」は判定しない。** 上流の欠陥は、発見した時点で例外なく同じ手順を通る。

- 起票は Tier A — 起票するか・どこへ起票するかをユーザーに確認しない。対象は first-party に限る（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
- **停止は無条件**。Issue を作ってから停止し、待つか先送りするかはユーザーが決める
- `backlogrun` の中では、停止はその子 Issue に限る。起票と回避策の禁止は変わらない。該当の子に `needs-decision` を付けて park し、依存していない他の子へ進む（→ `.claude/skills/workflow-commands/backlogrun-park.md` → "Only a person's judgement carries `needs-decision`"）

### 実行中のリポジトリ自身のラン機構の不具合

**実行中のリポジトリ自身はこの手順の対象外である。** kit の中で kit のラン機構（`backlog:drive`、`run:wake`、`run:carry`、レーン、分類、カウンタ、ガードなど）の不具合を見つけたら、上流 Issue で停止する代わりに、このリポジトリの割り込みとして次を行う。

1. **起票する** — `pnpm josh issue:file "<title>" --body-file <path> --route interrupt --label priority:high`。上限は効かない（`wip-cap.md` →「割り込み起票 — 上限が効かない側」の条件 2）
2. **止まらずに直す** — 壊れた機構を迂回せず、検証ゲートも緩めない。`backlogrun` の中では割り込みを次の子にし、着地後に塞がれていた子へ戻る（プールでは `priority:high` が先頭、epic の下では `wip-cap.md` の手順 3 で挿入、名前指定のランでは `pnpm josh lane:launch <N>` で自分で dispatch）。バッチの外では `wip-cap.md` の手順 4 どおり、打つべき `fullrun #<N>` を報告して止まる
3. **再開できるなら自分で再開し、動くことを確かめる** — 修正のマージ後、手渡し済み・所有者が死んだ記録・監督プロセスの停止（`warning` Telegram）には `pnpm josh run:wake --start`、`run:carry` の `standing` には `pnpm josh run:carry --resume "<invocation>" --owner "$PPID"` を打つ。`pnpm josh run:wake --list` が監督プロセスを示し、ログに次の子の dispatch が現れることを確かめて報告する
4. **人に打ち直しを求めるのは再開の手段が無いときだけ** — `mismatch`（別の起動の記録）、別の生きた所有者の `busy`。新しい承認を宣言するのは人だけ
5. **`needs-decision` を付けない**（`.claude/skills/workflow-commands/backlogrun-park.md` → "Only a person's judgement carries `needs-decision`"）

手順:

1. **現在の作業を退避する**: `pnpm josh stash:push "upstream-interrupt: paused #<N>"`（WIP コミットでも可）
2. **進行中の Issue に状況を書く**: `pnpm josh issue:comment <N> --body-file <path>` で、stash したこと、中断理由（どの別パッケージのどんな問題か）、新 Issue へのリンク（`## Upstream issues` 見出しの下に `owner/repo#N` 形式、→「起票元へのバックリンク」）
3. **対象パッケージのリポジトリに Issue を作成する（確認なし）**: `pnpm josh issue:file "<root-cause title>" --body-file <body-file> --route tier-a --repo <owner>/<repo>`（joshuafolkken/kit#1083）。検査・分類ラベル・重複探し・`epic:bundle` はコマンドが行う（`docs/josh-commands-backlog.md` → `josh issue:file`）。根本原因・再現・期待結果を `prompts/collaboration-workflow/issue-template.md` の Step 1 のテンプレで書き、`## Origin` 節に起票元 Issue を `owner/repo#N` 形式で書く
4. **`confirmation` Telegram を送って停止する**: 上流 Issue の URL と何が止まっているかを書く（→ `CLAUDE.md` → "Mid-workflow stop notification (`confirmation`)"）
5. **元の作業を再開する**: 上流の修正がマージされた、またはユーザーが先送りを明示判断した後に `pnpm josh stash:pop "upstream-interrupt: paused #<N>"` で復元する（`operating-rules.md` → "no-self-staging"）。上流 Issue を割り込みで実装するかもユーザーが決める

### first-party の Issue・PR への書き込みは確認不要

`pnpm josh repo:party` が `first-party` と答えたリポジトリの Issue・PR への書き込みは Tier A で、ユーザーに確認しない。起票、コメント、ラベル、本文の編集、`@dependabot rebase` などの Dependabot へのコマンドコメントを含む。

- 頼まれていない観察の起票はこの節で許可しない: この節が外すのは書き込み先の確認だけ。起票するかは `.claude/skills/workflow-commands/observation-filing.md` に従う
- `unknown` はこの節の対象外: first-party と判定できないので、書き込む前にユーザーに確認する

- **「外部への書き込み」は third-party への書き込みだけを指す**。first-party への書き込みをそう呼ばない
- マージ・ブランチ削除などの共有状態の操作は書き込みに含まれず、Tier C のまま（`CLAUDE.md` → "Git Rules"）

### 第三者リポジトリへの書き込みは Tier C（明示指示が必要）

「起票は確認なし」も「書き込みは確認不要」も first-party だけに成り立つ。

- **判定は `pnpm josh repo:party [<owner/repo>]` が答える**: `first-party` / `third-party` / `unknown`（unknown は third-party 扱いしない）。fork や contribute しているだけの org リポジトリも third-party
- **third-party への書き込みは種別を問わず Tier C**: Issue・コメント・PR・Discussion・レビュー、既存 Issue のクローズ・編集も、その turn のユーザーの明示指示なしに行わない。正しい診断も許可ではない
- third-party と判明したら: (1) 自分たちの側の Issue に証拠込みで所見を `## Upstream candidate` 見出しで記録する（`## Upstream issues` は使わない）。(2) 報告本文の下書きをその Issue 内に用意する。(3) 対象プロジェクト名と報告内容を書いた `confirmation` Telegram を送って停止する
- 下書きの前に揃える証拠: 自プロジェクトの外で成立する最小再現（無ければ「プロジェクト組み込みの再現しかない」と明記）、全主張の検証、既存 Issue の検索

### 検証ゲートを緩めることも「回避策」である

**上流の欠陥に合わせて `lint` / `tsc` / `cspell` / unit / E2E の出力を絞り込む・狭める・読み替えることは、ローカルパッチと同じ違反**で、同じ停止を引き起こす。

- 例: 上流が配布する設定で生成されるディレクトリ由来の型エラーを除外し、「プロジェクトソースはエラー 0」としてゲートを通す
- 絞り込みを開示しても、ルールを満たしたことにはならない
- ゲートを調整したくなった時点が、このルールの発火点である

注意:

- 上流起因と分かったら選択肢は根本対応だけ。「今回は軽いから即席で」はない
- 上流パッケージのマージ等の共有状態操作は Tier A ではない。それぞれのワークフローの明示起動を要する
