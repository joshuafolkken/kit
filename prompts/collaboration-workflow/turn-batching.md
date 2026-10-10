# 独立した呼び出しは同じターンに載せる（joshuafolkken/kit#1304）

「独立した呼び出しは同じターンに載せる」規則の正典。**常駐側には [`rule-delivery.md`](./rule-delivery.md) →「配送されている規則」への導線だけが残り、規則本文は `pnpm josh batch:guard` が効く瞬間に配送する**（joshuafolkken/kit#1524、`docs/maintainers/turn-batching-rationale.md` → "Why it left residency (joshuafolkken/kit#1524)"）。実測・却下した機構案・経緯は `docs/maintainers/turn-batching-rationale.md` にある。

## 何を求めているか

**判断は 1 問で決まる。**

> **この呼び出しの入力は、いま出していない別の呼び出しの結果に依存しているか。**

- no → **その呼び出しは、依存していない他の呼び出しと同じターンに載せる**
- yes → 結果を待つ。別のターンになるのが正しい

ファイルを 3 つ読むために 3 ターン使う、同じファイルの離れた 3 箇所を直すために 3 ターン使う、`git status` と `pnpm josh issue:state` を別ターンに分ける — いずれも禁じられた形である。**費用は仕事の量ではなく往復の回数にある。** 1 ターンの壁時計はほぼ一定なので、ターン数が run の下限を決める（実測は `docs/maintainers/turn-batching-rationale.md` → "Why the number of turns is the cost"）。

## 判断基準は「依存の有無」であって、呼び出しの種類ではない

**`Edit` も同じ規則の対象である** — 別々のファイルや同じファイルの離れた領域への編集は、互いの結果を使っていないので同じターンに載る。逆に、**依存があるなら分けるのが正しい**: `grep` の結果の行番号で `sed -n` を出す、`git switch` の成否を見てから次を出す、Edit の前に対象を読む（**Edit の前に読むことは省略できない**）。

## 検証ゲートとレビューは往復を減らす対象ではない

**ゲート・レビュー・差分の読み取りを、往復を減らす名目で弱めてはならない。** `pnpm josh gate` の出力を絞って失敗の内訳を読まずに進む、`git diff main...HEAD` を一部だけ読んで「指摘なし」とする（`output-bounds.md`）、走らせるべきチェックを落とす — いずれも禁止。**往復を減らすのは「同じ仕事を少ないターンで出す」ことであって、「仕事を減らす」ことではない。**

## ガードが見えないところ — ここでは自分で規則を当てる

中断中のターン・`Write`・書き込む `josh` サブコマンドや連鎖した行・ツールを呼ばないターン・ガードが `off` のレーン子は、ガードが止めない。止められなくても規則は同じく拘束する。一覧と機構は `docs/maintainers/turn-batching-rationale.md` → "Where the guard cannot see"、却下した案は `docs/maintainers/turn-batching-rationale.md` → "Rejected mechanisms"、範囲が広がった経緯は `docs/maintainers/turn-batching-rationale.md` → "How the guard's scope grew"。

## 事後の計測 — 実行タイミングレポートの `Round trips:`

**round trip は 1 ターンがまとめて出した呼び出しのかたまり 1 つ**で、しきい値 1.50 呼び出し/往復を下回ると 1 行の指摘が出る。`tool-less turns`（発話だけのターン）は自分で減らす。実装は `scripts/time-runtime/time-round-trips.ts`、読み方と実測は `docs/maintainers/turn-batching-rationale.md` → "Reading the round-trip measurement"。

## 実装中の独立編集に効く合成コマンド（joshuafolkken/kit#2202）

**Step 0 が対象ファイルを列挙した時点で、`pnpm josh read:files <path> …` で読み取りを 1 回に畳み、続く独立した編集は `pnpm josh edit:files` の 1 呼び出しで送る**（`report-format.md` が導く。`old` が 1 箇所に一致しなければ拒否される）。ガードが発火して `read:files` / `edit:files` を手渡したら、その 1 呼び出しで出し直す。形式は `docs/josh-commands-run.md` →「`josh read:files`」と「`josh edit:files`」、経緯は `docs/maintainers/turn-batching-rationale.md` → "The composite commands"。

## マーカーテスト

`scripts/rules/turn-batching-rule.test.ts` が固定する。内訳は `docs/maintainers/turn-batching-rationale.md` → "What the marker test pins"。
