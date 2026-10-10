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

auto-merge と `completion` 通知・明示的な起動・`confirmation` 通知・作業ツリーの保持・overrides の保護は、それぞれの単一ソースにあり、ここには繰り返さない。移動先の一覧は `docs/maintainers/operating-rules-rationale.md` → "Rules that moved to their single source"。

### 指示されていない行動は取らない

規則そのもの — 共有状態に影響する操作はその場で明示指示されたものだけ実行し、マージを認可するのはどのコマンドの起動か — は `CLAUDE.md` → "Git Rules" に常駐している。ここに書くのは、その規則を実行するときの細則である。対象には共有ブランチへの push・外部通知の追加送信・リポジトリ設定の変更も含まれる。

- auto-merge の本文は [`followup.md`](../../.claude/skills/workflow-commands/followup.md)、`backlogrun` の子への継承は [`backlogrun-child.md`](../../.claude/skills/workflow-commands/backlogrun-child.md)
- `kickoff` / `pnpm josh followup` 単独実行は文書化されたスコープで終了する。PR が OPEN のまま完了したら状態を報告して停止する
- 「チェックが全部 green だから次のステップに進む」は承認ではない
- **deny と配送ガードは実装であって規則ではない。** `gh pr merge`・force push・ブランチ削除の直接実行は `.claude/settings.json` の `permissions.deny` と `pnpm josh rule:guard` が拒否する（一覧は各ファイルと [`rule-delivery.md`](./rule-delivery.md) →「配送されている規則」）が、それらは規則より狭い — 取りこぼす綴りを禁じ、ツールが通したことを許可と読ませないのは `CLAUDE.md` → "Git Rules" である。`fullrun` の auto-merge は `pnpm josh followup` の内部から gh を起動するため影響を受けない
- **共有状態に影響する操作（このセクションの対象＝Tier C）は迷ったら確認する。** 確認のコストは低いが、意図しない操作の巻き戻しは高コスト
- ただしこの「迷ったら確認」は Tier C に限る。**可逆な実装・設計判断（Tier A）は別ルール**（下記「意思決定の自律ポリシー」）に従う

### no-self-staging — git index を勝手に変更しない（自律 staging の禁止）

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
- **`git stash` は例外的に、次の明文化されたフローの中でのみ自動実行してよい**:
  1. `fullrun new` / `halfrun new` の手順 5（作業ツリーに変更がある状態で `josh latest` を回す前の退避）
  2. `backlogrun` のラン開始時の `josh latest`
  3. 「別パッケージ起因の問題は割り込み Issue で対応する」
  4. `backlogrun` が epic の子を始める前の preflight（`pnpm josh run:hold <N>` が `reclaim` と答えたときの回収 — joshuafolkken/kit#926, joshuafolkken/kit#1965）

  **4 番目だけが復元を伴わない。1〜3 はいずれも直後に `pnpm josh stash:pop "<メッセージ>"` で復元することが手順に含まれている**（stash はリポジトリ単位の 1 本のスタックを全 work tree が共有するため、位置指定や引数なしの `git stash pop` は別のレーンが最後に積んだ stash を取り込む — メッセージで対象を特定する。joshuafolkken/kit#2050）。 回収するのは異常終了したランの置き土産であって、いま実行中のランの作業ではないから、pop して戻す先がない。**代わりに stash を子の Issue にコメントで記録する** — 前提 Issue で中断するときの stash（`prerequisite.md`）と同じく、**その記録だけが後で pop させられる唯一の手がかり**であり、記録し忘れた stash は誰にも拾われない。これら以外の場面で退避したくなったときは、実行せずに先に確認する

- **会話で作った実装をランへ渡す「引き渡し用の stash」も `pnpm josh stash:pop "<メッセージ>"` で復元する。当てたあと stash は消える**（経緯は `docs/maintainers/operating-rules-rationale.md` → "Why a handed-over stash is popped"）
  - **計画には復元手順としてこの 1 行だけを書く。** `git stash apply` / `git stash pop` も「drop しない」という条件も書かない
  - **計画がガードの拒否する復元形を指していたら、実行側は `stash:pop` に読み替えて続行し、Issue コメントに残す（Tier A）。** `needs-decision` では止まらない
  - **stash を残すのは持ち主の判断だけである。** 持ち主が計画に理由を書き、ランはそこで止まって確認する

- **staging・index の書き換え・`git commit` の直接実行は deny されており、deny には「そのターンでユーザーが明示指示した」という例外がない。** だから上記ケース 1 は AI 側では実行できず、ユーザー自身の端末で実行してもらう。ユーザーが明示的にコミットを指示した場合も、承認済みのコミットは `pnpm josh git` を通す（理由は `docs/maintainers/operating-rules-rationale.md` → "Why the index is the user's"）
- index を守る deny と `pnpm josh rule:guard`（`worktree-mutation`・`index-mutation`・`destructive-command`・`protected-file` 行）も事故防止の実装である — 上記「指示されていない行動は取らない」→「deny と配送ガードは実装であって規則ではない」

### decision-autonomy — 意思決定の自律ポリシー（確認停止を減らす）

3 層の定義（Tier A / B / C）、起票した Issue の epic 所属と自己修正が Tier A であること、自動判断の記録先は `CLAUDE.md` → "Decision autonomy" に常駐している。ここに書くのは、その境界の細則である。

- **A と B の判定基準**: 確認するのは「差が僅差 **かつ** 後戻りしにくい／アーキテクチャに長く影響する」ときだけ。「迷っている」だけでは停止理由にならない — 明確に優位な選択肢は多少の不確実性が残っても自動で選び、僅差でも安価に巻き戻せる選択は自動で決めて記録して進む
- **起票した Issue の所属先は、候補が複数の epic に散っていても Tier B ではない**（joshuafolkken/kit#1339）。`epic --add` 1 回で移せるので推奨する 1 つを選び、採用・却下・理由・決定日を Issue と epic の両方に記録して進む。止まるのは 2 つの epic が本当に甲乙つけがたいときだけである
- **自己修正**は設計判断ではなく後始末である — 自分が公開した成果物の事実誤り（誤った帰属を含む）の訂正と、同じセッションで自分が特定した自分の作業の抜けの穴埋め（例: 欠けていると自分で指摘した相互リンクの追加）。どちらも可逆で、望ましい結果が 1 つしかなく、問題を迂回せず既に行った作業を修復するだけなので、回避策のリスクはない
- **「相談と実行を区別する」との境界**: ここでの Tier A は **すでに承認され実行された作業を完了・修復する**ことに限られる。目標の表明（「〜したい」）や進め方への問い（「どうすべき？」）に対して勝手に動いてよい、という意味ではない（→ `principles.md` → "consult-vs-execute"）
- **Tier C との境界**: 自分のコメントの訂正は Tier A。マージ・ブランチ削除・force push・スコープ外の変更は、**その問題を招いたのが自分自身であっても** Tier C のまま。確認を外しても監査証跡は外さない
- **major のバージョン bump は Tier C**: `pnpm josh bump major` は自分の判断で実行せず、提案もしない。破壊的な変更に見えても既定は minor / patch で、major はユーザーがそのターンで明示したときだけ（0.x の major は 1.0.0 になり、戻せない公開を伴う）。`josh bump` が版を変えたら、変わった挙動の `docs/` をコミット前に更新する
- **自動判断の記録の書き方**: Issue 駆動ワークフロー内では `pnpm josh issue:comment <N> --body-file <path>` で、採用案・不採用の代替案・なぜ採用案が明確に優位かを記載する
