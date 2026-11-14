# 更新前に npm への取得経路を準備する

この入口は既存の kit を読み込まず、プロジェクトの `.npmrc` とロックだけを移行する。
ユーザーの `~/.npmrc`、認証設定、インストール済み kit は変更しない。

## 移行の順序

`@joshuafolkken` を GitHub Packages から取得している既存プロジェクトは、次の順で進める。
新規導入は移行不要（[README → Quick start](../README.md#quick-start)）。

1. 取得前の確認：プロジェクトのルートで `pnpm config get "@joshuafolkken:registry"` を実行する。
   `https://npm.pkg.github.com` を指す場合が移行対象。ユーザーの `~/.npmrc` の設定もこの値に現れる。
2. 入口を取得し（[配布と境界](#配布と境界)）、`--dry-run` で変更予定のファイル、または失敗した name@version と理由を確認する。
3. dry-run が通ったら同じ版で本実行する。失敗時はファイルを変更しない。原因を直して同じコマンドを再実行する。
4. npm から対象 kit を取得し、その kit の sync を実行する。

   ```sh
   pnpm add -D @joshuafolkken/kit@<target-version>
   pnpm exec josh sync
   pnpm install
   ```

5. 認証なしの確認：`pnpm config get "@joshuafolkken:registry"` が `https://registry.npmjs.org/` を返し、`pnpm-lock.yaml` に `npm.pkg.github.com` が残らないこと。

この入口を含む kit を導入済みのプロジェクトでは、`pnpm josh version --upgrade` が手順 3 の入口を先に実行してから npm の kit を追加する（[package-api.md → Version-command library](./package-api.md#version-command-library-joshuafolkkenkitversion)）。その後に手順 4 の `josh sync` と `pnpm install` を実行する。
global CLI は `~/.npmrc` を変えずに npm から取得できる（[cli.md](./cli.md#1-install-globally)）。

### 移行後に残る作業

- プロジェクトの `.npmrc` には `@joshuafolkken:registry=https://registry.npmjs.org/` が入る。commit する。秘密情報は含まない。
- ユーザーの `~/.npmrc` は変更しない。`@joshuafolkken` の GitHub mapping とトークン行は、他のプロジェクトがまだ GitHub Packages から取得しているなら残す。不要になった時点で自分で削除する。
- 他スコープを GitHub Packages から取得するプロジェクトは、そのスコープの mapping と認証を残す（[authentication.md](./authentication.md)）。
- Cloudflare Workers Builds・Vercel・Netlify・Docker 等のビルダーに設定した `NODE_AUTH_TOKEN`、`npm_config_//npm.pkg.github.com/:_authToken`、`PNPM_CONFIG_NPMRC_AUTH_FILE` は、他に GitHub Packages の依存がなければ削除する。残す依存があれば維持する（[authentication.md §4](./authentication.md#4-build-platforms-with-no-user-level-npmrc)）。
- kit の CI テンプレートは npm から取得する。独自の CI に GitHub Packages 用の認証手順を追加していれば、同じ基準で削除または維持する。

### 対象外

- GitHub Packages への publish 停止と、既存版の削除はこの移行に含まない。既存の GitHub 取得は引き続き動く。
- 公開済み版を実際の consumer リポジトリと公開 tarball で通す最終実証は、公開後に #7447 で行う。それまでこの文書の確認済み範囲は、pack した候補 tarball による検証に限る。

## 配布と境界

公開する kit tarball の `package/dist/registry-migrate.mjs` が依存を内包する独立入口。
npm の公開 metadata が示す tarball を HTTPS で直接取得し、metadata の sha512 と取得物を照合してから、このファイルを取り出す。
照会先は `https://registry.npmjs.org/@joshuafolkken%2fkit/<published-entry-version>`。
取得は Node の標準 fetch 等で直接行い、ユーザー設定を読む npm/pnpm の取得コマンドを介さない。
ローカル候補の検証では `pnpm pack` の tarball から `tar -xzf <archive> package/dist/registry-migrate.mjs` で取り出し、kit のないディレクトリで実行する。
パッケージマネージャーで入口をインストールしないため、プロジェクトやユーザーの scope mapping は入口取得に関与しない。
`pnpm dlx --registry` だけで scope mapping を上書きできるとは扱わない。

本 Issue の検証対象は実際に pack した候補 tarball。公開済み版の取得実証は #7447 で行う。
公開前の版を指定する完成済み取得手順は提供しない。

取得・検証済みの入口を、移行対象プロジェクトのルートで実行する。
`<target-version>` は npm から取得したい kit の完全なバージョン番号。

```sh
node /path/to/registry-migrate.mjs <target-version> --dry-run
node /path/to/registry-migrate.mjs <target-version>
```

引数なしや不明なフラグでは使い方を表示し、ファイルを変更せず終了コード 1 で終わる。`--help` は使い方だけを表示する。

移行成功後に通常の pnpm 操作で対象 kit を npm から取得し、その kit の `josh sync` を実行する（[移行の順序](#移行の順序)の手順 4）。
入口自身は kit の更新・新規初期化・sync を実行しない。
既存の `josh init` bootstrap と retired な `registry:migrate` は変更しない。
npm へ移行したプロジェクトでは、`josh sync` が kit の書いた `prepare` から `fix-gh-packages` を外す（[sync.md](./sync.md#what-does-not-get-synced)）。

## 検証する条件

- pnpm 12.17.0 で検証した。別の版はファイル変更前に停止する。
- 直接・間接依存を含め、ロックの全同スコープ name@version と対象 kit の npm 公開情報・実配布物を確認する。
- 配布物の sha512 を npm metadata と旧ロックの両方に照合する。同じ版でも bytes が異なる配布物は拒否する。圧縮や内容の差異を自動承認しない。両配布元の実物を独立に検証する必要がある。
  差異の調査では両 tarball の sha512 を記録し、展開前のパス・種類・mode・リンク先と各ファイルの内容ハッシュを比較する。特に manifest、依存関係、実行コードを確認する。この調査を入口による旧 integrity の自動置換に結び付けない。
- 旧ロックに integrity がない場合も停止する。checksum 無効化や無条件の integrity 置換はしない。
- 一時コピーで `pnpm update --patches --lockfile-only --ignore-scripts --ignore-pnpmfile` を実行する。旧 kit の hooks は実行しない。独自 hooks が必要なプロジェクトで依存グラフが変わる場合は停止する。
- 再解決後にも実配布物を検証する。依存グラフ・他スコープの metadata が変わった場合、GitHub tarball が残る場合も停止する。
- 成功後にプロジェクト設定とロックを反映する。反映中の例外では元に戻す。並行変更を検出したら反映しない。プロセス強制終了・電源断にまたがる複数ファイルの原子性は保証しない。
- dry-run は同じ検証を実行し、変更するファイル名または失敗した name@version と理由を表示する。

再解決は [pnpm update の registry revision 更新](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/cli/update.md#--patches)を利用する。
`--force`・`--fix-lockfile` で integrity 問題が解決するとは扱わない。
pnpm の lockfile-only 更新は tarball をダウンロードしないため、入口自身の実配布物照合が必要になる。
