# 引き金つき配送 — 規則を「効く瞬間」に届ける（joshuafolkken/kit#1524）

規則の届け方は**常駐**（`CLAUDE.md` に書き毎ターン読み込ませる）と**引き金つき配送**（効く瞬間にフックが本文を突きつける）の 2 つ。

## なぜ配送が要るのか

`docs/maintainers/rule-delivery-rationale.md` → "Why delivery is needed"。

## 判定基準 — 引き金を特定できるか

どの規則を配送へ移すかは [`residency.md`](./residency.md) →「第 1 問」に従う。

## 機構 — 1 本だけ、新規に作らない

入口は `PreToolUse` の `pnpm josh pretool:guard`（バッチング ／ 調査 ／ 規則の 3 ガード）と Stop フックの `pnpm josh stop:guard` の 2 つ。**2 本目の配送経路を作るのは `CLAUDE.md` →「No clones」が禁じるクローン**である。配送は呼び出しの書き換え（`updatedInput`）でもよい — 規則の結果そのものを機械的に作れる形に限る。書き換えは `pnpm josh rule:value` が `rewritten` として数える。配線・停止スイッチ・拒否の優先順位: `docs/maintainers/rule-delivery-rationale.md` → "The mechanism"。

## 配送されている規則

一覧は `pnpm josh rule:list` が `scripts/rules/delivered-rules.ts` から生成する（joshuafolkken/kit#3399）。各項目は規則の単一ソース・発火点・発火しないときを持ち、フックが走らないエージェントはその出力を自己適用のチェックリストにする（`principles.md`）。

**引き金はシェルのコマンド文字列しか見えない**（node 内の REST や `gh api --input <file>` は掛からない）ので、常駐側にトリガ 1 行を残す（`docs/maintainers/rule-delivery-rationale.md` → "Shell evaluation of a body is one more row of the same mechanism"）。

引き金が発火しないターンでは何も起きないのが仕様で、各項目の発火しない状態は「規則が守られている状態」と一致させる。一致が取れない規則は常駐に残す。

## 配送は 1 ラン 1 回

配送文はラン 1 回につき 1 度しか出ないので、**「同じ呼び出しをもう一度出せ」と明記する**。例外: 繰り返す行為を止める項目は毎回発火し（joshuafolkken/kit#1570）、前提の行為を求める項目は前提が末尾に現れるまで毎回拒否する（joshuafolkken/kit#2807）— その配送文にはそれぞれ「これは毎回発火する」「前提が末尾に現れるまで拒否する」と明記する。バッチングと調査の 2 ガードは違反が間隔分続けば再び発火する（joshuafolkken/kit#2164）。前提の証拠を読めないときは拒否する。経緯: `docs/maintainers/rule-delivery-rationale.md` → "One delivery per run"。

## マーカーテスト

`docs/maintainers/rule-delivery-rationale.md` → "Marker tests"。
