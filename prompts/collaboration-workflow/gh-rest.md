# `gh` は REST（`gh api`）で書く — 散文の指示も含む

## 規則

**GitHub への操作は `gh api`（REST）で書く。** `gh issue …` / `gh pr …` / `gh repo …` のサブコマンド形は使わない —
クラウドセッションでは GraphQL への egress が `403` で拒否される。

例外は 2 つだけ:

- `gh auth token` — ローカルの認証情報を返すだけで、どのエンドポイントにも接続しない
- GitHub Actions のワークフロー — ランナー上では `gh` が動き、`gh pr merge --auto` の API は GraphQL にしか無い

## 認証は環境によって別物である

**手元では `gh auth login` を一度実行すれば足り、`GH_TOKEN` は要らない**（認証情報は OS のキーチェーン）。
**CI とクラウドセッションにはキーチェーンが無いので、`GH_TOKEN` を設定する。** 説明を書くときは両方を書く。

## 散文でも「指示の形」なら REST で書く

**文書の散文に書いたコマンドでも、読み手に実行を指示する形なら REST で書く。**

- 指示の形（REST で書く）— 「数えるのはコマンド 1 つで済む: `…`」「各子 Issue に `…` でコメントを書く」のように、
  読み手がそのまま打つ書き方
- 引用の形（そのままでよい）— 「`gh issue create` は使わない」のような禁止の引用や、CLI の対応状況の記録

文書ガードはフェンス付きコードブロックだけを走査するので、散文は書き手がこの区別で守る。

書き換えるときは先に `pnpm josh` のコマンドで置き換えられないかを見る（例: `gh issue view` ではなく
`pnpm josh issue:state <N>`）。

## REST 化は `gh` を不要にしない

REST 呼び出しも `execa('gh', ['api', …])` なので、`gh` が無いコンテナでは `pnpm josh epic:next` /
`pnpm josh pr` / `pnpm josh followup` も完了しない。`epic:next` / `epic:bundle` / `issue:scout` / `epic --add` が
「Could not read this repository from `git remote`, so the children cannot be keyed by repository — check
`gh auth status` and that this is a checkout with an `origin` remote.」と出したら、**まず `gh` の有無を確かめる。**

環境ごとの前提とホストは [`docs/cloud-session.md`](https://github.com/joshuafolkken/kit/blob/main/docs/cloud-session.md)。
