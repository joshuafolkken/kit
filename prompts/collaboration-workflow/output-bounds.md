# コマンド出力が文脈へ持ち込む量の上限（joshuafolkken/kit#1173）

**上限は機構で決まり、実行側の判断には委ねられない。** 配布される `.claude/settings.json` の `env` ブロックが `BASH_MAX_OUTPUT_LENGTH` を宣言し、Claude Code は Bash ツールの出力がこの文字数を超えると真ん中を省略して渡す。

```json
"env": {
	"BASH_MAX_OUTPUT_LENGTH": "8000"
}
```

**8,000 文字**（harness の既定は 30,000、受け付ける最大は 150,000）。値の根拠となった分布と却下した案は `docs/maintainers/output-bounds-rationale.md` → "Why 8,000"。上限は **Bash ツールにだけ効き**、`Read` と `Agent` の結果には効かない。

## 切り詰められたときにどうするか

**情報を落とすのではなく、必要な範囲に合わせて読み直す。** 同じコマンドを再実行しても上限は同じなので、絞り込んで読む:

- ファイルなら範囲を指定する（`sed -n '120,180p' <file>`）か、`Read` ツールの `offset` / `limit` を使う
- 一覧なら件数を絞る（`--limit`、`| head -30`）、JSON なら必要な項目だけ取り出す（`gh api … --jq '…'`）
- どうしても全量が要るときは、いったんファイルへ落として（`> <file>`）から範囲を読む

## 切り詰められた出力を、完全な出力として読まない

**検証ゲートと差分は、切り詰められた結果で判断しない。** 省略された箇所には harness がマーカーを残す — それは「短い出力」ではなく「一部しか読んでいない出力」である。

- **`pnpm josh gate`** は合否の 1 行を末尾に出すので判定は失われない。失敗の内訳が切れたら、合否行の直前に出る **`full output: <path>` のファイルを読む**（joshuafolkken/kit#1227）
- **差分には判定行が無い。** 欠けた差分で「指摘なし」とするのはゲートを弱めたのと同じなので、**差分はファイルへ落としてから範囲で読む**（`git diff main...HEAD > /tmp/diff.patch && wc -l /tmp/diff.patch`）

## 検証コマンドをパイプに繋がない（joshuafolkken/kit#1556）

**パイプラインの終了コードは最後のコマンドのものである。** `pnpm josh gate 2>&1 | tail -40` は `tail` の終了コードで終わるので、**赤いゲートがシェルの上では成功として返る。** **これは `josh gate` の欠陥ではない。** POSIX どおりの挙動であり、直すべきは呼び出し方である。

- **既定はパイプなしで実行する。** 判定行は末尾に出るので、上限で真ん中が省略されても残る
- 絞るなら、ファイルへ落として範囲で読む（`pnpm josh gate > /tmp/gate.log 2>&1; tail -40 /tmp/gate.log`）。リダイレクトは終了コードを奪わない
- パイプが避けられないなら `set -o pipefail` を前置する
- **どの形でも、印字された判定行を読む。終了コードだけを答えにしない**

**対象は結果が合否を意味するコマンドだけ** — `gate` ／ `check` ／ `lint*` ／ `cspell*` ／ `test*` ／ `eval`。**`git log | head` や `gh issue list | head` は対象外であり、意図的にそうしている。** `latest:scope` ／ `review:brief` も、判定ではなく答えを印字するので `$(...)` で受けてよい。`pnpm josh pretool:guard` は検証コマンドをパイプした `Bash` を、行が検証と後段の `tail` ／全行読みの `grep` だけなら `pipefail` 前置に書き換え、他は拒否する（`rule-delivery.md`）。経緯・却下した案・検査は `docs/maintainers/output-bounds-rationale.md` → "Why the pipe rule is delivered by a trigger"。

## 検査

`scripts/lib/bash-output-cap.test.ts` が、配布設定の上限がこの文書の値と一致し、harness の既定より小さく最大を超えないことを固定する（`docs/maintainers/output-bounds-rationale.md` → "What the tests pin"）。
