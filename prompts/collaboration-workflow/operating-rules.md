## 運用ルール

- 通知は CI チェック成功後に投稿する
- 通知投稿に失敗しても、実装完了の事実はログで確認できるようにする
- 自動投稿される Issue コメント文面は `JOSH_SESSION_LANG` の言語（未設定なら `ja`）で記載する。Issue タイトルだけは英語で固定する

### CI チェック失敗時の対応

`pnpm josh followup` は Required チェックのみ待機するが、**Workers Builds（Cloudflare デプロイ）など非 Required チェックが失敗した場合も必ずユーザーに明示的に報告する**。

- `pnpm josh followup` が印字するチェック一覧を確認し、失敗しているチェックがあればすべて列挙する。手で読み直すときは `gh api repos/{owner}/{repo}/commits/<head-sha>/check-runs --jq '.check_runs[] | {name, conclusion}'` を使う（`gh pr checks` は GraphQL を通るためクラウドセッションでは 403 になる）
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
- **マージ戦略**: 内部で pull request のマージエンドポイントを `merge_method` 付きで叩く（`gh pr merge` は GraphQL を通るためクラウドセッションでは 403 になる、joshuafolkken/kit#1029）。既定は merge commit。**この経路は `followup` のものであってエージェントのものではない** — `.claude/settings.json` は `gh pr merge` に加え、joshuafolkken/kit#1062 以降は同じマージの `gh api` 表記（`Bash(gh api *pulls/*/merge*)`）と `gh api graphql` 表記も拒否する。`followup` は node スクリプト内部から gh を起動するため影響を受けない。**ただし deny は実装であって規則ではない** — パターンが取りこぼす綴りを禁じているのは本節の規則のほうである。リポジトリが `allow_squash_merge` / `allow_rebase_merge` のみを許可している場合はそれに合わせる（`gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` で確認）
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
- **`gh pr merge` の直接実行は kit 配布の `.claude/settings.json` の `deny`（`Bash(gh pr merge*)`）で機械的に遮断されている。** `fullrun` の auto-merge は `pnpm josh followup --merge` が node スクリプト内部から gh を起動するため影響を受けない — Bash マッチャに見えるのは `pnpm josh …` だけである
- **同じ規則が禁じる force push とブランチ削除も deny に載っている**（joshuafolkken/kit#1062）。`Bash(git push *--force*)` / `Bash(git push * -f)` はフラグを引数の後ろに書いた綴りを、`Bash(git push *--delete*)` / `Bash(git branch -d*)` / `Bash(git branch -D*)` / `Bash(gh api *DELETE*git/refs/heads/*)` はブランチ削除を止める。**それでも deny は規則より狭い** — `git -C` を前置した綴り、短縮フラグをまとめた綴り（`git push -uf`）は全エントリを素通りし、ルール文字列は `:` をリテラルとして照合できないため `git push origin :branch` も拒否されない。**「マージ経路は deny が保証している」とは読まないこと**
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
  2. 承認済みのコミットフローの一部として実行される（`pnpm josh git`、および `fullrun` / `queue` の起動に含まれるコミット手順。`halfrun` はコミットしないので含まれない）
- 上記以外で staging が必要だと考えたときは、**実行せずに先に確認する**
- 同じ理由で、`git reset` / `git checkout -- <path>` / `git restore <path>` など index や作業ツリーを破壊的に書き換える操作も、自分の判断で実行しない
- **`git stash` は例外的に、明文化されたフローの中でのみ自動実行してよい**: `fullrun new` / `halfrun new` の手順 5（作業ツリーに変更がある状態で `josh latest` を回す前の退避）、`queue` の手順 1、`epicrun` のラン開始時の `josh latest`（`queue` の手順 1 と同じ場面）、および「別パッケージ起因の問題は割り込み Issue で対応する」。いずれも直後に `git stash pop` で復元することが手順に含まれている。これら以外の場面で退避したくなったときは、実行せずに先に確認する
- **この禁止は kit 配布の `.claude/settings.json` の `deny`（`Bash(git add*)` / `Bash(git stage*)` / `Bash(git rm*)` / `Bash(git mv*)` / `Bash(git reset*)` / `Bash(git restore --staged*)` / `Bash(git restore -S*)` / `Bash(git commit -a*)` / `Bash(git commit --all*)`）で機械的にも遮断されている。** `pnpm josh git` は node スクリプト内部から git を起動するため影響を受けず、承認済みのコミットフロー（上記ケース 2）は従来どおり動く。**deny には「そのターンでユーザーが明示指示した」という例外がないため、上記ケース 1 も AI 側では実行できない** — その場合はユーザー自身の端末で実行してもらう（ユーザーの手元では従来どおり動く）。恒久的な機械的保証のほうが、コマンド 1 本で回避できる例外より価値が高いという判断（joshuafolkken/kit#850）
- **「拒否される操作」と「禁止された操作」は同じ集合ではない。** deny に載っているのは上記の直接実行だけで、このセクションが同じく禁じている `git checkout -- <path>` / `git restore <path>` は実行できてしまう。**ツールが通したことを許可と読み替えてはならない** — 何をしてよいかを決めるのは deny ではなくこのルールである
- このルールは横断ドキュメント（CLAUDE.md「Git Rules」→「Never stage or mutate the git index on your own」）のカノニカル参照

### 意思決定の自律ポリシー（確認停止を減らす）

AI ツール（Opus / Gemini / Cursor）が判断の分岐で止まりすぎるのを防ぐため、各判断を3層に分類して扱う。停止して確認するのは**本当にユーザーの判断が必要な分岐だけ**にする。このセクションが横断ドキュメント（CLAUDE.md「Decision autonomy」）のカノニカル参照。

- **Tier A — 可逆な実装・設計判断**（明確に優位な選択肢があるライブラリ選定、命名、ファイル構成、テスト手法、リファクタの形）。メリット比較で1案が明確に優位なら**確認せず自動で選んで進める**。本来ユーザー確認すべき分岐だった場合は、後から監査・差し戻せるよう判断を記録する（下記「自動判断の記録」）
- **Tier B — 本当に甲乙つけがたい判断**。上位2案がどちらも妥当で差が僅差。**ここだけが停止する層** — ユーザーに確認する（`AskUserQuestion` が使えるなら使う）。拮抗する候補とトレードオフを提示する
- **Tier C — 不可逆・共有状態・スコープ外の操作**（マージ、ブランチ削除、force push、破壊的操作、リポジトリ設定変更、タスク範囲外の変更、`devEngines` / overrides の編集（`pnpm-workspace.yaml` `overrides:` と `package.json` `pnpm.overrides` のいずれも））。**このポリシーの対象外。** 1案が明確に優位に見えても、常にユーザーの明示指示を要する。既存の安全ルール（上記「指示されていない行動は取らない」、`devEngines` / overrides 保護）が優先される

**A と B の判定基準**: 確認するのは「差が僅差 **かつ** 後戻りしにくい／アーキテクチャに長く影響する」ときだけ。「迷っている」だけでは停止理由にならない — 明確に優位な選択肢は多少の不確実性が残っても自動で選び、僅差でも安価に巻き戻せる選択は自動で決めて記録して進む。

**Tier A に含まれる「自己修正」**: 次の 2 つは設計判断ではなく後始末であり、**確認せずに実行してよい**。

- **自分が公開した成果物の事実誤りの訂正**: Issue / PR コメントや Issue 本文の誤記・誤った帰属（例: 欠陥を実際とは別のパッケージに帰属させた記述）を、自分で訂正する
- **同じセッションで自分が特定した、自分の作業の抜けの穴埋め**: 例として、欠けていると自分で指摘した相互リンクを後から追加する

どちらも可逆で、望ましい結果が 1 つしかなく、放置をユーザーが選ぶことはない。**この半分に回避策のリスクはない** — 問題を迂回するのではなく、既に行った作業を修復するだけだからである。

- **「相談と実行を区別する」との境界**: ここでの Tier A は **すでに承認され実行された作業を完了・修復する**ことに限られる。目標の表明（「〜したい」）や進め方への問い（「どうすべき？」）に対して勝手に動いてよい、という意味ではない（→「相談と実行を区別する（議論中にファイルを編集しない）」）
- **Tier C との境界（再掲）**: 自分のコメントの訂正は Tier A。マージ・ブランチ削除・force push・スコープ外の変更は、**その問題を招いたのが自分自身であっても** Tier C のまま
- 記録は下記「自動判断の記録」に従う。確認を外しても監査証跡は外さない

**自動判断の記録**: 本来確認すべき Tier A の分岐を自動判断したときは、候補と理由を記録する:

- Issue 駆動ワークフロー内（`kickoff` / `halfrun` / `fullrun` / `queue`）: `gh api repos/{owner}/{repo}/issues/<N>/comments -f body="..."` で、採用案・不採用の代替案・なぜ採用案が明確に優位かを記載する
- Issue が存在しない会話タスク: 同じ内容を「Auto-decided: `<choice>` over `<alt>` because `<reason>`」の1行として応答に明示する

### `completion` 通知は `pnpm josh followup` 経由のみ

`task_type=completion`（✅）の Telegram 通知は `pnpm josh followup` が自動送信する経路のみを使う。`pnpm josh notify --task-type completion ...` を手動で実行してはならない。

- 理由: 手動 CLI では `--pr-url` を明示しない限り PR URL が欠落する。`pnpm josh followup` は内部で `repos/{owner}/{repo}/pulls/{N}`（REST）から PR URL を取得して必ず付与するため、通知から PR リンクが消える事故を防げる
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

### overrides の保護（`pnpm-workspace.yaml` / `package.json` の両方を見る）

overrides に設定された制約は、**セキュリティ・互換性・動作保証のために意図的に追加されたもの**である。

**overrides は 2 箇所に置かれ、片方だけを見ても答えにならない。** pnpm 11 は `pnpm-workspace.yaml` の `overrides:` ブロックを読む（kit と app-kit の overrides は実際にここにある）。`package.json` の `pnpm.overrides` は旧来の置き場所である。**`pnpm.overrides` が空、あるいはそもそも `pnpm` フィールドが無いことは、そのプロジェクトに overrides が無いことの証拠にはならない** — app-kit の `package.json` には `pnpm` フィールドが一切無いが、`pnpm-workspace.yaml` には実際の override が存在する。`package.json` しか見ずに「保護すべき overrides は無い」と結論してはならない。それはルールが検出すべき状態そのもので合格を報告する振る舞いであり、しかも点検が空振りしたという信号を一切残さない（kit #740）。

- **確認は「実行するコマンド」であって「到達する結論」ではない。** `josh latest` / `pnpm update --latest` などの依存更新コマンドの実行後は、`git diff -- pnpm-workspace.yaml package.json` を実行し、`overrides:` ブロックと `pnpm.overrides` の双方が無傷であることを確認する
- `josh latest` は overrides の判定を自分で出力する（最後の overrides 行が `✔ overrides unchanged (<n> from <file>)`、変化していれば `⚠ overrides changed` 警告）。`pnpm josh overrides` は保存済みスナップショットと両ファイルを比較する。**実際に出力された行を引用して報告する**こと — 推測した判定を書いてはならない
- overrides が自動的に変更・削除された場合は、**理由を調査してから**ユーザーに報告し、明示的な承認なしに変更してはならない
- 例: `"esbuild@<=0.24.2": ">=0.25.0"` などのバージョン制約は、Workers ビルド互換性やパッケージの動作保証のために入れてある場合がある
