# `gh` は REST（`gh api`）で書く — 散文の指示も含む

## 規則

**GitHub への操作は `gh api`（REST）で書く。`gh issue …` / `gh pr …` / `gh repo …` といったサブコマンド
形は使わない。** クラウドセッション（エージェントのコンテナ）では GitHub の GraphQL エンドポイントへの
egress が `403` で拒否されるため、GraphQL を経由するサブコマンドはそこで一切動かない。

例外は 2 つだけである。

- **`gh auth token`** — ローカルの CLI が既に持っている認証情報を返すだけで、どのエンドポイントにも
  接続しない。REST で書き換えられる呼び出しが存在しない。読み出すのはローカルの認証情報だけである。
- **GitHub Actions のワークフロー** — ランナー上では `gh` が通常どおり動き、`gh pr merge --auto` が使う
  API は GraphQL にしか存在しない。

## 散文でも「指示の形」なら REST で書く

**この規則はフェンス付きコードブロックの中だけの話ではない。文書の散文に書かれたコマンドでも、読み手に
実行を指示する形であれば REST で書く。**

- **指示の形**（REST で書く）— 「数えるのはコマンド 1 つで済む: `…`」「各子 Issue に `…` でコメントを
  書く」のように、読み手がそのまま打つことを期待している書き方。
- **引用の形**（そのままでよい）— 「`gh issue create` は使わない」のような禁止の引用や、「このサブコマンドは
  GraphQL を経由する」のような CLI の対応状況の記録。書き換えると、何を禁じているのかが読めなくなる。

**この区別は機械には引けない。** `scripts/gh-document-guard.test.ts` はフェンス付きコードブロックだけを
走査する。散文まで広げると、41 箇所のうち 39 箇所が「禁止の引用」か「対応状況の記録」であるため、
allowlist に 25 件を並べることになり、それは何も守らない（joshuafolkken/kit#1505）。そこでガードは
フェンスに留め、散文の側はこの規則と `scripts/gh-prose-rest-rule.test.ts` のマーカーテストで押さえる。

**書き換えるときは `pnpm josh` のコマンドで置き換えられないかを先に見る。** 例えば Issue の状態を読むのは
`gh issue view` ではなく `pnpm josh issue:state <N>` で、これはラベルと `human_review` まで一度に返す。

## REST 化は `gh` を不要にしない

**すべての REST 呼び出しは今も `execa('gh', ['api', …])` である。** サブコマンドをやめたことで消えたのは
GraphQL への依存であって、バイナリへの依存ではない。**`gh` が入っていないコンテナは実在する** — その環境
では `pnpm josh epic:next` も `pnpm josh pr` も `pnpm josh followup` も完了できず、`fullrun` / `epicrun`
は GitHub に一切到達しない。`git push` が通り `GH_TOKEN` が効いていても、である。

`check_gh_installed` は `gh CLI is not installed` と明示するが、git remote からリポジトリを読む側の
コマンド（`epic:next` / `epic:bundle` / `issue:scout` / `epic --add`）は「Could not read this
repository from `git remote`, so the children cannot be keyed by repository — check `gh auth status`
and that this is a checkout with an `origin` remote.」と出るため、原因が `gh` の不在であることが読み取り
にくい。**そのメッセージを見たら、まず `gh` の有無を確かめる。**

環境ごとの前提と、開けるべきホストの一覧は
[`docs/cloud-session.md`](https://github.com/joshuafolkken/kit/blob/main/docs/cloud-session.md) にある。
