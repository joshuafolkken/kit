# コマンド出力が文脈へ持ち込む量の上限（joshuafolkken/kit#1173）

配布される `.claude/settings.json` の `env` ブロックが `BASH_MAX_OUTPUT_LENGTH` を宣言し、Bash ツールの出力がこの文字数を超えると真ん中が省略される。

```json
"env": {
	"BASH_MAX_OUTPUT_LENGTH": "8000"
}
```

**8,000 文字**（harness の既定は 30,000、最大は 150,000）。効くのは Bash ツールだけで、`Read` と `Agent` の結果には効かない。

## 切り詰められたときにどうするか

**情報を落とすのではなく、必要な範囲に合わせて読み直す。** 再実行ではなく絞り込む:

- ファイルは範囲を指定する（`sed -n '120,180p' <file>`、または `Read` の `offset` / `limit`）
- 一覧は件数を絞る（`--limit`、`| head -30`）、JSON は必要な項目だけ取り出す（`gh api … --jq '…'`）
- 全量が要るときは、ファイルへ落として（`> <file>`）から範囲を読む
- 退避された `tool-results/<id>.txt` → `grep -n` ／ `sed -n` で読む（`lane-spilled-read` 行、`pnpm josh rule:list`）

## 切り詰められた出力を、完全な出力として読まない

**検証ゲートと差分は、切り詰められた結果で判断しない。**

- `pnpm josh gate` は合否の 1 行を末尾に出す。失敗の内訳が切れたら、合否行の直前の `full output: <path>` のファイルを読む（joshuafolkken/kit#1227）
- `pnpm josh test:related` ／ `test:unit` が失敗した → 最後の `failed tests:` 一覧と `full output: <path>` を読む。読むための再実行はしない。直したら、まず要約の `rerun failed:` 行で失敗したファイルだけを回し、関連集合の全体は最後の `check:related` で 1 回だけ回す（`scripts/test/vitest-failure-summary.ts`）
- 差分には判定行が無い。差分はファイルへ落としてから範囲で読む（`git diff main...HEAD > /tmp/diff.patch && wc -l /tmp/diff.patch`）

## 検証コマンドをパイプに繋がない（joshuafolkken/kit#1556）

**パイプラインの終了コードは最後のコマンドのものである。** `pnpm josh gate 2>&1 | tail -40` は赤いゲートを成功として返す。**これは `josh gate` の欠陥ではない。** **既定はパイプなしで実行する。** 避けられないなら `set -o pipefail` を前置する。どの形でも、印字された判定行を読む。`piped-verification` 行（`rule-delivery.md`）が強制する。

対象は結果が合否を意味するコマンドだけ — `gate` ／ `check*` ／ `lint*` ／ `cspell*` ／ `test*` ／ `eval`。**`git log | head` や `gh issue list | head` は対象外であり、意図的にそうしている。** `latest:scope` ／ `review:brief` も、判定ではなく答えを印字するので `$(...)` で受けてよい。

## 検査

`scripts/lib/bash-output-cap.test.ts` が、配布設定の上限がこの文書の値と一致し、既定より小さく最大を超えないことを固定する。
