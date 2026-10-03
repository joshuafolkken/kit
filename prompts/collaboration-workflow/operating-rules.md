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

### ほかの単一ソースにある規則

このファイルにかつて書き直されていた規則は、次の単一ソースにある。ここには繰り返さない。単一ソース化の経緯は `docs/maintainers/operating-rules-rationale.md` → "Rules that moved to their single source" にある。

- **auto-merge と `completion` 通知** — `.claude/skills/workflow-commands/followup.md` → "`auto-merge` — Default `fullrun` behavior" と `.claude/skills/workflow-commands/followup.md` → "Completion notifications: always via `pnpm josh followup`"
- **明示的な起動が必須** — `CLAUDE.md` → "Explicit invocation required (MANDATORY)"（常駐）と `.claude/skills/workflow-commands/SKILL.md` → "0. The rule that fires before any of them — explicit invocation"（スキル側の単一ソース）
- **確認待ちで停止するときの Telegram 通知** — `CLAUDE.md` → "Mid-workflow stop notification (`confirmation`)"
- **作業ツリーは 1 本のランが保持する（`josh run:hold`）** — `.claude/skills/workflow-commands/working-tree-hold.md` → "The working-tree hold — one run per tree"
- **overrides の保護** — `.claude/skills/dependency-update/SKILL.md` → "1. Effective overrides live in the workspace — inspect both files"

### 指示されていない行動は取らない

PR マージ・ブランチ削除・force push・共有ブランチへの push・外部通知の追加送信・リポジトリ設定の変更など、**共有状態に影響する操作はその場でユーザーに明示指示されたものだけ実行する**。

- `fullrun` の auto-merge は `fullrun` の指示自体に含まれるため許可される（本文は [`followup.md`](../../.claude/skills/workflow-commands/followup.md)）。それ以外の状況で勝手にマージしてはならない
- `kickoff` / `pnpm josh followup` 単独実行は文書化されたスコープで終了する。PR が OPEN のまま完了したら状態を報告して停止する
- 「チェックが全部 green だから次のステップに進む」は承認ではない
- **`gh pr merge` の直接実行は kit 配布の `.claude/settings.json` の `permissions.deny` で機械的に遮断されている。** パターンの一覧はそのファイルが一次情報であり、ここでは書き写さない。 `fullrun` の auto-merge は `pnpm josh followup` が node スクリプト内部から gh を起動するため影響を受けない — Bash マッチャに見えるのは `pnpm josh …` だけである。**ただし deny は実装であって規則ではない** — パターンが取りこぼす綴りを禁じているのは本節の規則のほうである
- **同じ規則が禁じる force push とブランチ削除も deny に載っている**（joshuafolkken/kit#1062）。**deny は規則より狭いが、その差は配送ガードが埋めている** — `git -C` を前置した綴り、短縮フラグをまとめた綴り（`git push -uf`）、`:` をリテラルにできず glob が照合できない `git push origin :branch` は、いずれも `pnpm josh rule:guard` の `git-force` 行が argv を解析して拒否する（joshuafolkken/kit#2120）。**「マージ経路は deny が保証している」とは読まないこと**
- **共有状態に影響する操作（このセクションの対象＝Tier C）は迷ったら確認する。** 確認のコストは低いが、意図しない操作の巻き戻しは高コスト
- ただしこの「迷ったら確認」は Tier C に限る。**可逆な実装・設計判断（Tier A）は別ルール**（下記「意思決定の自律ポリシー」）に従う

### git index を勝手に変更しない（自律 staging の禁止）

規則そのもの — index はユーザーのスナップショットであり、自分の判断でステージ・コミットしない — は `CLAUDE.md` → "Git Rules" に常駐している。ここに書くのは、その規則を実行するときの細則である。index には履歴がなく、上書きされた直前のステージ状態は復元できない（経緯は `docs/maintainers/operating-rules-rationale.md` → "Why the index is the user's"）。

- **調査目的の staging は絶対に行わない。** 調査は読み取り専用コマンドで行う:
  - 変更ファイル一覧: `git status --short`
  - 作業ツリーの差分: `git diff` / `git diff --stat` / `git diff HEAD`
  - ステージ済みの差分: `git diff --staged`（読み取りのみ、index は変えない）
  - **未追跡ファイルの中身**: `git diff --no-index /dev/null <new-file>`（staging 不要）。あるいは単にファイルを直接読む
- **staging してよいのは次の 2 ケースだけ**:
  1. ユーザーが**そのターンで明示的に**ステージを指示した
  2. 承認済みのコミットフローの一部として実行される（`pnpm josh git`、および `fullrun` / `backlogrun` の起動に含まれるコミット手順。`halfrun` はコミットしないので含まれない）
- 上記以外で staging が必要だと考えたときは、**実行せずに先に確認する**
- **レーンの中で競合を解決したあとの「解決済み」の記録は、ケース 2 に含まれる（Tier A）。** レーンは run 専用の作業ツリーで、守るべき利用者の staging はない。利用者に `git add` の許可を求めず、`pnpm josh git -y` で記録する。手順は `.claude/skills/workflow-commands/chain-rule.md` →「origin/main is merged in before the gate」の 1 か所にだけ書く（joshuafolkken/kit#2445）
- 同じ理由で、`git reset` / `git checkout -- <path>` / `git restore <path>` など index や作業ツリーを破壊的に書き換える操作も、自分の判断で実行しない
- **`git stash` は例外的に、明文化されたフローの中でのみ自動実行してよい**: `fullrun new` / `halfrun new` の手順 5（作業ツリーに変更がある状態で `josh latest` を回す前の退避）、`backlogrun` のラン開始時の `josh latest`、「別パッケージ起因の問題は割り込み Issue で対応する」、および `backlogrun` が epic の子を始める前の preflight（`pnpm josh run:hold <N>` が `reclaim` と答えたときの回収 — joshuafolkken/kit#926, joshuafolkken/kit#1965）。**この 5 番目だけが復元を伴わない。前の 4 つはいずれも直後に `pnpm josh stash:pop "<メッセージ>"` で復元することが手順に含まれている**（stash はリポジトリ単位の 1 本のスタックを全 work tree が共有するため、位置指定や引数なしの `git stash pop` は別のレーンが最後に積んだ stash を取り込む — メッセージで対象を特定する。joshuafolkken/kit#2050）。 回収するのは異常終了したランの置き土産であって、いま実行中のランの作業ではないから、pop して戻す先がない。**代わりに stash を子の Issue にコメントで記録する** — 前提 Issue で中断するときの stash（`SKILL.md` §2d）と同じく、**その記録だけが後で pop させられる唯一の手がかり**であり、記録し忘れた stash は誰にも拾われない。これら以外の場面で退避したくなったときは、実行せずに先に確認する
- **この禁止は kit 配布の `.claude/settings.json` の `permissions.deny`（staging・index の書き換え・`git commit` の直接実行）で機械的にも遮断されている。** `pnpm josh git` は node スクリプト内部から git を起動するため影響を受けず、承認済みのコミットフロー（上記ケース 2）は従来どおり動く。**deny には「そのターンでユーザーが明示指示した」という例外がないため、上記ケース 1 も AI 側では実行できない** — その場合はユーザー自身の端末で実行してもらう。**ユーザーが明示的にコミットを指示した場合も同じで**、承認済みのコミットは `pnpm josh git` を通す（`git commit` まで deny に入れた理由は `docs/maintainers/operating-rules-rationale.md` → "Why the index is the user's"）
- **「拒否される操作」と「禁止された操作」は同じ集合ではない。** deny に載っているのは上記の直接実行だけだが、このセクションが同じく禁じている `git checkout -- <path>` / `git restore <path>` / 認可外の `git stash`（bare・メッセージ無し push・位置指定 pop など。メッセージ付き `git stash push -m` と `pnpm josh stash:pop` は認可済みなので通る）は、`pnpm josh rule:guard` の `worktree-mutation` 行が拒否する（joshuafolkken/kit#2120）。同じ配送ガードは、`index-mutation` 行（`git add` / `commit` / `reset` / `rm` / `mv` / `restore --staged`）、`worktree-mutation` 行の強制 `git clean -f`、`destructive-command` 行（`rm -rf`・`gh repo delete` / `archive`・`gh pr close`・`gh api -X DELETE`。Issue ラベルの削除だけは除く）、`protected-file` 行（`.env` の読み取りと kit 以外での `.claude/settings.json` の編集）も拒否する（joshuafolkken/kit#2983）。これらは事故防止のためであり、回避を防ぐ境界ではない。**ツールが通したことを許可と読み替えてはならない** — 何をしてよいかを決めるのは deny でも配送ガードでもなくこのルールである（フックは Claude Code にしか届かない）

### 意思決定の自律ポリシー（確認停止を減らす）

3 層の定義（Tier A / B / C）、起票した Issue の epic 所属と自己修正が Tier A であること、自動判断の記録先は `CLAUDE.md` → "Decision autonomy (minimize confirmation stops)" に常駐している。ここに書くのは、その境界の細則である。

- **A と B の判定基準**: 確認するのは「差が僅差 **かつ** 後戻りしにくい／アーキテクチャに長く影響する」ときだけ。「迷っている」だけでは停止理由にならない — 明確に優位な選択肢は多少の不確実性が残っても自動で選び、僅差でも安価に巻き戻せる選択は自動で決めて記録して進む
- **起票した Issue の所属先は、候補が複数の epic に散っていても Tier B ではない**（joshuafolkken/kit#1339）。`epic --add` 1 回で移せるので推奨する 1 つを選び、採用・却下・理由・決定日を Issue と epic の両方に記録して進む。止まるのは 2 つの epic が本当に甲乙つけがたいときだけである
- **自己修正**は設計判断ではなく後始末である — 自分が公開した成果物の事実誤り（誤った帰属を含む）の訂正と、同じセッションで自分が特定した自分の作業の抜けの穴埋め（例: 欠けていると自分で指摘した相互リンクの追加）。どちらも可逆で、望ましい結果が 1 つしかなく、問題を迂回せず既に行った作業を修復するだけなので、回避策のリスクはない
- **「相談と実行を区別する」との境界**: ここでの Tier A は **すでに承認され実行された作業を完了・修復する**ことに限られる。目標の表明（「〜したい」）や進め方への問い（「どうすべき？」）に対して勝手に動いてよい、という意味ではない（→ `principles.md` → "相談と実行を区別する"）
- **Tier C との境界**: 自分のコメントの訂正は Tier A。マージ・ブランチ削除・force push・スコープ外の変更は、**その問題を招いたのが自分自身であっても** Tier C のまま。確認を外しても監査証跡は外さない
- **自動判断の記録の書き方**: Issue 駆動ワークフロー内では `pnpm josh issue:comment <N> --body-file <path>` で、採用案・不採用の代替案・なぜ採用案が明確に優位かを記載する
