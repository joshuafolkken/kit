## 運用ルール

- 通知は CI チェック成功後に投稿する
- 通知投稿に失敗しても、実装完了の事実をログで確認できるようにする
- 自動投稿する Issue コメントは `JOSH_SESSION_LANG` の言語（未設定なら `ja`）で書く。Issue タイトルだけは英語

### CI チェック失敗時の対応

`pnpm josh followup` は Required チェックだけを待つが、Workers Builds（Cloudflare デプロイ）など**非 Required チェックの失敗もユーザーに報告する**。

- `pnpm josh followup` が印字するチェック一覧から失敗をすべて列挙する。手で読み直すときは `gh api repos/{owner}/{repo}/commits/<head-sha>/check-runs --jq '.check_runs[] | {name, conclusion}'`（`gh pr checks` は GraphQL を通るためクラウドセッションで 403）
- 修正できたら修正内容を、できなかったら失敗チェック名・原因・未解決である旨を `--notify-message` に書く。**完了コメントに失敗を隠してはならない**
- ユーザーへの報告でも失敗を「成功」として扱わない

### 指示されていない行動は取らない

`CLAUDE.md` → "Git Rules" の細則。対象には共有ブランチへの push・外部通知の追加送信・リポジトリ設定の変更も含む。

- auto-merge の本文は [`followup.md`](../../.claude/skills/workflow-commands/followup.md)、`backlogrun` の子への継承は [`backlogrun-child.md`](../../.claude/skills/workflow-commands/backlogrun-child.md)
- `kickoff` / `pnpm josh followup` 単独実行は文書化されたスコープで終了する。PR が OPEN のまま完了したら状態を報告して停止する
- 「チェックが全部 green」は次へ進む承認ではない
- **deny と配送ガードは実装であって規則ではない。** `gh pr merge`・force push・ブランチ削除は `.claude/settings.json` の `permissions.deny` と `pnpm josh rule:guard` が拒否する（一覧は [`rule-delivery.md`](./rule-delivery.md) →「配送されている規則」）が、規則より狭い。ツールが通したことを許可と読まない。`fullrun` の auto-merge は `pnpm josh followup` の内部から gh を起動するため影響を受けない
- 共有状態に影響する操作（Tier C）は、迷ったら確認する。可逆な実装・設計判断（Tier A）は下記 "decision-autonomy" に従う

### no-self-staging — git index を勝手に変更しない（自律 staging の禁止）

`CLAUDE.md` → "Git Rules" の細則。index には履歴がなく、上書きされたステージ状態は復元できない。

- **調査目的の staging はしない。** 読み取り専用コマンドを使う: `git status --short`、`git diff` / `git diff --stat` / `git diff HEAD`、`git diff --staged`、未追跡ファイルは `git diff --no-index /dev/null <new-file>` か直接読む
- staging してよいのは次の 2 ケースだけ。それ以外は実行せずに確認する:
  1. ユーザーがそのターンで明示的にステージを指示した
  2. 承認済みのコミットフロー（`pnpm josh git`、`fullrun` / `backlogrun` のコミット手順。`halfrun` は含まない）
- レーンの中で競合を解決したあとの記録はケース 2（Tier A）。許可を求めず `pnpm josh git -y` で記録する。手順は `.claude/skills/workflow-commands/chain-rule.md` →「origin/main is merged in before the gate」（joshuafolkken/kit#2445）
- `git reset` / `git checkout -- <path>` / `git restore <path>` など index や作業ツリーを破壊的に書き換える操作も、自分の判断で実行しない
- **`git stash` を自動実行してよいのは次のフローだけ**。ほかの場面では実行せずに確認する:
  1. `fullrun new` / `halfrun new` の手順 5（`josh latest` 前の退避）
  2. `backlogrun` のラン開始時の `josh latest`
  3. 「別パッケージ起因の問題は割り込み Issue で対応する」
  4. `backlogrun` が epic の子を始める前の preflight（`pnpm josh run:hold <N>` が `reclaim` と答えたときの回収 — joshuafolkken/kit#926, joshuafolkken/kit#1965）

  1〜3 は直後に `pnpm josh stash:pop "<メッセージ>"` で復元する。stash は全 work tree が共有する 1 本のスタックなので、位置指定や引数なしの `git stash pop` は使わない（joshuafolkken/kit#2050）。4 は復元しない — 代わりに stash を子の Issue にコメントで記録する（`prerequisite.md` の stash と同じく、記録だけが後で pop させる手がかり）

- **会話で作った実装をランへ渡す「引き渡し用の stash」も `pnpm josh stash:pop "<メッセージ>"` で復元する。当てたあと stash は消える**
  - 計画には復元手順としてこの 1 行だけを書く。`git stash apply` / `git stash pop` も「drop しない」という条件も書かない
  - 計画がガードの拒否する復元形を指していたら、実行側は `stash:pop` に読み替えて続行し、Issue コメントに残す（Tier A）。`needs-decision` では止まらない
  - stash を残すのは持ち主の判断だけ。持ち主が計画に理由を書き、ランはそこで止まって確認する
- staging・index の書き換え・`git commit` の直接実行は deny されており、deny には「そのターンでユーザーが明示指示した」という例外がない。ケース 1 はユーザー自身の端末で実行してもらう。コミットを指示されたら `pnpm josh git` を通す
- index を守る deny と `pnpm josh rule:guard`（`worktree-mutation`・`index-mutation`・`destructive-command`・`protected-file` 行）も実装である（→「deny と配送ガードは実装であって規則ではない」）

### decision-autonomy — 意思決定の自律ポリシー（確認停止を減らす）

`CLAUDE.md` → "Decision autonomy" の境界の細則。

- **A と B の判定**: 確認するのは「差が僅差 かつ 後戻りしにくい／アーキテクチャに長く影響する」ときだけ。明確に優位な選択肢は自動で選び、僅差でも安価に巻き戻せる選択は決めて記録して進む
- 起票した Issue の所属先は、候補が複数の epic に散っていても Tier B ではない（joshuafolkken/kit#1339）。1 つを選び、採用・却下・理由・決定日を Issue と epic の両方に記録する。止まるのは 2 つが本当に甲乙つけがたいときだけ
- 自己修正（自分が公開した成果物の事実誤りの訂正、同じセッションで自分が特定した自分の作業の抜けの穴埋め）は Tier A。承認済みの作業の完了・修復に限り、目標の表明や問いで動いてよい意味ではない（→ `principles.md` → "consult-vs-execute"）
- **Tier C との境界**: マージ・ブランチ削除・force push・スコープ外の変更は、自分が招いた問題でも Tier C。確認を外しても監査証跡は外さない
- **major のバージョン bump は Tier C**: `pnpm josh bump major` は自分の判断で実行も提案もしない。既定は minor / patch で、major はユーザーがそのターンで明示したときだけ（0.x の major は 1.0.0 になり戻せない）。`josh bump` が版を変えたら、変わった挙動の `docs/` をコミット前に更新する
- 自動判断の記録: Issue 駆動ワークフロー内では `pnpm josh issue:comment <N> --body-file <path>` で、採用案・不採用の代替案・採用案が優位な理由を書く
