## 背景

- 種別: 非不具合
- 目的: 廃止したラベルを open の Issue から外す
- 人の判断: 要（ラベル削除の `gh api -X DELETE` は Tier C で、ランからは実行できない）
- リリース分類: other-change

joshuafolkken/kit#4108 で `depth:0` / `depth:1` / `depth:2` を廃止した。最後の受け入れ条件「マージ後に open の Issue だけから外す」は、ラベルの削除が Tier C のためランが実行できなかった。

## 現象

2026-10-18 時点で depth ラベルが付いている open の Issue:

- `depth:0`: #4103, #4091, #4067, #2907, #2605
- `depth:1`: #4115, #4108, #4107, #4099, #4095, #4005, #4002
- `depth:2`: #4077

## 期待結果

#4108 のマージ後、open の Issue に `depth:*` が残らない。closed の Issue とリポジトリのラベル定義はそのまま。

## 受け入れ条件

- [ ] #4108 のマージ後、open の Issue から `depth:0` / `depth:1` / `depth:2` を外す（closed の Issue とラベル定義は残す）。`gh api "repos/joshuafolkken/kit/issues?state=open&labels=depth:<n>" --jq length` が 0/1/2 すべてで `0` になる
