# 更新前に npm への取得経路を準備する

この入口は既存の kit を読み込まず、プロジェクトの `.npmrc` とロックだけを移行する。
ユーザーの `~/.npmrc`、認証設定、インストール済み kit は変更しない。

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

移行成功後に通常の pnpm 操作で対象 kit を npm から取得し、その kit の `josh sync` を実行する。
入口自身は kit の更新・新規初期化・sync を実行しない。
既存の `josh init` bootstrap と retired な `registry:migrate` は変更しない。
sync、prepare、CI、利用案内の追従は #7443・#7445・#7446 が担当する。

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
