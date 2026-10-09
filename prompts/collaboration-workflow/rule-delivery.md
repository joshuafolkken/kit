# 引き金つき配送 — 規則を「効く瞬間」に届ける（joshuafolkken/kit#1524）

規則の届け方は 2 つある。**常駐**（`CLAUDE.md` に書き、毎ターン読み込ませる）と、**引き金つき配送**（規則が効く瞬間にフックが本文を突きつける）である。この文書は後者の単一ソースである。配線・判定の細部と経緯は `docs/maintainers/rule-delivery-rationale.md` にあり、ランの途中で読む必要はない。

## なぜ配送が要るのか

常駐の経路は実効上限で詰まっており、配送は該当する瞬間だけのコストで届き、拒否は読み飛ばせず、発火を単体テストで固定できる。経緯: `docs/maintainers/rule-delivery-rationale.md` → "Why delivery is needed"。

## 判定基準 — 引き金を特定できるか

どの規則を配送へ移すかの単一ソースは [`residency.md`](./residency.md) →「第 1 問」であり、ここには写さない。

## 機構 — 1 本だけ、新規に作らない

配送はすべて 1 つの土台に載り、入口はイベントごとに 2 つある。`PreToolUse` の入口が `pnpm josh pretool:guard`（バッチング ／ 調査 ／ 規則の 3 ガードを 1 プロセスで合成）、Stop フックの入口が `pnpm josh stop:guard` である。**2 本目の配送経路を作るのは `CLAUDE.md` →「No clones」が禁じるクローン**である。**配送は拒否とは限らず、呼び出しの書き換え（`updatedInput`）でもよい** — 規則の結果そのものを機械的に作れる形に限る。書き換えはフックが添える注記で記録され、`pnpm josh rule:value` が `rewritten` として数える。配線・停止スイッチ・拒否の優先順位: `docs/maintainers/rule-delivery-rationale.md` → "The mechanism"。

## 配送されている規則

一覧は `pnpm josh rule:list` が `scripts/rules/delivered-rules.ts` の行から生成する（joshuafolkken/kit#3399）。各項目は規則の単一ソース・発火点・発火しないときを持ち、フックが走らないエージェントはその出力を自己適用のチェックリストにする（`principles.md`）。

**引き金はシェルのコマンド文字列しか見えない**（node 内の REST や `gh api --input <file>` は掛からない）。だから常駐側にトリガ 1 行を残し、配送はそれを効く瞬間に補強する。経緯: `docs/maintainers/rule-delivery-rationale.md` → "Shell evaluation of a body is one more row of the same mechanism"。

**「引き金が発火しないターンでは何も起きない」ことは仕様である。** 各項目の発火しない状態は「規則が守られている状態」と一致する。一致が取れない規則は常駐に残す。**誤ったターンで発火するフックは、フックが無いより悪い。**

## 配送は 1 ラン 1 回

配送文は**ラン 1 回につき 1 度**しか出ないので、**「同じ呼び出しをもう一度出せ」と明記する**。例外は 2 つで、繰り返す行為を止める項目は毎回発火し（joshuafolkken/kit#1570）、前提の行為を求める項目は前提が末尾に現れるまで毎回拒否する（joshuafolkken/kit#2807）。その配送文にはそれぞれ「これは毎回発火する」「前提が末尾に現れるまで拒否する」と明記する。バッチングと調査の 2 ガードは違反が間隔分続けば再び発火する（joshuafolkken/kit#2164）。前提の証拠を読めないときは拒否を基本とする。経緯: `docs/maintainers/rule-delivery-rationale.md` → "One delivery per run"。

## マーカーテスト

各項目を固定するスイートの一覧: `docs/maintainers/rule-delivery-rationale.md` → "Marker tests"。
