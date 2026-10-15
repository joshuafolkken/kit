# 独立した呼び出しは同じターンに載せる（joshuafolkken/kit#1304）

常駐側には [`rule-delivery.md`](./rule-delivery.md) →「配送されている規則」への導線だけが残り、規則本文は `pnpm josh batch:guard` が効く瞬間に配送する（`docs/maintainers/turn-batching-rationale.md` → "Why it left residency (joshuafolkken/kit#1524)"）。

## 何を求めているか

> **この呼び出しの入力は、いま出していない別の呼び出しの結果に依存しているか。**

- no → その呼び出しは、依存していない他の呼び出しと同じターンに載せる
- yes → 結果を待つ。別のターンになるのが正しい

ファイル 3 つを 3 ターンで読む、`git status` と `pnpm josh issue:state` を別ターンに分ける — いずれも禁止。**費用は仕事の量ではなく往復の回数にある。**（`docs/maintainers/turn-batching-rationale.md` → "Why the number of turns is the cost"）

## 判断基準は「依存の有無」であって、呼び出しの種類ではない

**`Edit` も同じ規則の対象である** — 別ファイルや離れた領域への編集は同じターンに載せる。依存があるなら分ける: `grep` の行番号で `sed -n` を出す、`git switch` の成否を見てから次を出す、Edit の前に対象を読む（省略できない）。

## 検証ゲートとレビューは往復を減らす対象ではない

ゲートの失敗の内訳を読まずに進む、差分を一部だけ読んで「指摘なし」とする（`output-bounds.md`）、チェックを落とす — いずれも禁止。**往復を減らすのは「同じ仕事を少ないターンで出す」ことであって、「仕事を減らす」ことではない。**

## ガードが見えないところ — ここでは自分で規則を当てる

中断中のターン・`Write`・書き込む `josh` サブコマンドや連鎖した行・ツールを呼ばないターン・ガードが `off` のレーン子でも、規則は同じく拘束する。一覧は `docs/maintainers/turn-batching-rationale.md` → "Where the guard cannot see"、却下した案は `docs/maintainers/turn-batching-rationale.md` → "Rejected mechanisms" と `docs/maintainers/turn-batching-rationale.md` → "How the guard's scope grew"。

## 事後の計測 — 実行タイミングレポートの `Round trips:`

round trip は 1 ターンがまとめて出した呼び出しのかたまり 1 つで、1.50 呼び出し/往復を下回ると 1 行の指摘が出る。`tool-less turns`（発話だけのターン）は自分で減らす。実装は `scripts/time-runtime/time-round-trips.ts`、読み方は `docs/maintainers/turn-batching-rationale.md` → "Reading the round-trip measurement"。

## 実装中の独立編集に効く合成コマンド（joshuafolkken/kit#2202）

**Step 0 が対象ファイルを列挙したら、`pnpm josh read:files <path> …` で読み取りを 1 回に畳み、続く独立した編集は `pnpm josh edit:files` の 1 呼び出しで送る**（`old` が 1 箇所に一致しなければ拒否される）。ガードが `read:files` / `edit:files` を手渡したら、その 1 呼び出しで出し直す。形式は `docs/josh-commands-run.md` →「`josh read:files`」と「`josh edit:files`」、経緯は `docs/maintainers/turn-batching-rationale.md` → "The composite commands"。固定するテストは `docs/maintainers/turn-batching-rationale.md` → "What the marker test pins"。
