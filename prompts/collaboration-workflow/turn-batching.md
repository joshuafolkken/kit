# 独立した呼び出しは同じターンに載せる（joshuafolkken/kit#1304）

`CLAUDE.md` →「Put every call that does not depend on another's result in the same turn」の正典。**常駐側にはトリガと判断基準の 1 行だけが残り、規則本文は `pnpm josh batch:guard` が効く瞬間に配送する**（joshuafolkken/kit#1524、下の「なぜ resident ではなく引き金つき配送に置くか」）。

## 何を求めているか

**判断は 1 問で決まる。**

> **この呼び出しの入力は、いま出していない別の呼び出しの結果に依存しているか。**

- no → **その呼び出しは、依存していない他の呼び出しと同じターンに載せる**
- yes → 結果を待つ。別のターンになるのが正しい

依存していない呼び出しを 1 つずつ別のターンに出す形が、この規則が禁じているものである。ファイルを 3 つ読むために 3 ターン使う、同じファイルの離れた 3 箇所を直すために 3 ターン使う、`git status` と `pnpm josh issue:state` と `pnpm josh latest:scope` を 3 ターンに分ける — いずれも後続の入力が前の結果を使っていない。

## なぜターン数が費用なのか

**費用は仕事の量ではなく往復の回数にある。** joshuafolkken/kit#1295 の run（1,471 秒 / 153 ターン）で実測した:

| 種別                                                             | 回数 | ツール実行時間の合計 |
| ---------------------------------------------------------------- | ---: | -------------------: |
| `Edit`                                                           |   34 |                48 秒 |
| 読み取り系の小さな `Bash`（`grep` 12 / `sed` 11 / `cat` 4 ほか） |   32 |                 6 秒 |

**ツール自体が動いていたのは合わせて約 54 秒**である。同じ 66 往復が消費した壁時計は 66 × 9〜13 秒 ≒ 600〜850 秒で、1 桁違う。1 ターンあたりの壁時計は 9〜13 秒の狭い帯に収まるので、**ターン数がそのまま run の下限を決めている。**

ゲート短縮が run を縮めなかった経緯は `docs/maintainers/turn-batching-rationale.md` →「ゲートを削っても run が縮まなかった理由」。

## 判断基準は「依存の有無」であって、呼び出しの種類ではない

読み取りだけの規則ではない。**`Edit` も同じ規則の対象である** — 同じファイルの離れた領域や、別々のファイルへの編集は、互いの結果を使っていないので同じターンに載る（実測の内訳は `docs/maintainers/turn-batching-rationale.md` →「`Edit` が最大の単一項目だった理由」）。

逆に、**依存があるなら分けるのが正しい。** 次はいずれも 1 つ前の結果を入力に使うので、同じターンに載せてはならない。

- `grep` の結果を見てから、その行番号で `sed -n` を出す
- `git switch` の成否を見てから `pnpm josh latest:scope` を出す
- Edit の対象文字列を確かめるために先にファイルを読む（**Edit の前に読むことは省略できない**）

## 検証ゲートとレビューは往復を減らす対象ではない

**ゲート・レビュー・差分の読み取りを、往復を減らす名目で弱めてはならない。** これは joshuafolkken/kit#1304 の受け入れ条件そのものである。具体的には:

- `pnpm josh gate` の出力を絞り込んで読む、失敗の内訳を読まずに次へ進む — いずれも禁止
- `git diff main...HEAD` を一部だけ読んでレビューを「指摘なし」と結論づける — 禁止（`output-bounds.md` →「切り詰められた出力を、完全な出力として読まない」と同じ理由）
- 単発の再実行（`pnpm josh lint:related` / `pnpm josh test:related`）をまとめるために、走らせるべきチェックを落とす — 禁止

**往復を減らすのは「同じ仕事を少ないターンで出す」ことであって、「仕事を減らす」ことではない。** 減らしてよいのはターンの数だけである。

## 機構で強制しない理由（却下した案）

- **PreToolUse フックが「1 件の呼び出しだけを見て、それが独立かどうかを判定する」。** 採れない。**呼び出しの独立性は、1 件の呼び出しからは観測できない。** フックが見るのはこれから走る 1 件だけで、それが直前の結果に依存しているかどうかはフックの入力に無い。依存している正当な直列実行（`grep` → `sed -n`、Edit の前の読み取り）を止めてしまい、しかも止めた側は理由を説明できない。`output-bounds.md` が「形で見分ける案は実データ上で外れる」として PreToolUse guard を却下したのと同じ形である。

  **却下したのはこの判定のしかたであって、`PreToolUse` という機構そのものではない。** joshuafolkken/kit#1390 は**まさに `PreToolUse` フックとして** `pnpm josh batch:guard` を実装し、`.claude/settings.json` で配布している。判定に使うのは、いま出そうとしている 1 件ではなく**閉じた履歴** — 結果が返り終わったターンの並び — である。単発呼び出しのターンが 2 つ続いたことは 1 件からは見えないが、履歴からは見える。上に並べた懸念は、それぞれ設計で避けてある。依存は**共有ターゲット**で見るので `grep` → `sed -n` は止まらず、**書き込みも読み取りとまったく同じ基準で拒否され**（joshuafolkken/kit#1762）、**手元の呼び出しが直前の列と共有ターゲットを持つときは拒否を取り下げる**（書き込み同士を含む）。拒否は 1 つの単発連続につき **1 回だけ**である（窓を超える連続は `docs/maintainers/turn-batching-rationale.md` →「`batch:guard` の拒否窓」）。委譲された子やレビューエージェントは、親の記録を共有せず、それぞれに配送される（`docs/maintainers/turn-batching-rationale.md` →「フォークへの配送の実装（joshuafolkken/kit#1424）」）。機構の全体は `docs/josh-commands.md` →「`josh batch:guard`」にある。範囲が `Bash|Edit|Read` に広がった経緯（joshuafolkken/kit#1509 を含む）は `docs/maintainers/turn-batching-rationale.md` →「書き込みが範囲に入った経緯（joshuafolkken/kit#1762）」、`docs/maintainers/turn-batching-rationale.md` →「読み取りが範囲に入った経緯（joshuafolkken/kit#1798）」、`docs/maintainers/turn-batching-rationale.md` →「事務コマンドが範囲に入った経緯（joshuafolkken/kit#1875）」。

  **ガードが見えないところ — ここでは自分で規則を当てる。**

  - **塞ぎきれないのは「いま中断しているターンの中身」であり、これは transcript から観測できないので設計上残る。** 同じファイルへの編集 3 件を 1 ターンにまとめた場合、先頭だけが拒否され残り 2 件が適用されることはある。**ただし壊れるのではなく失敗する** — 再発行された編集は書いたときの本文に一致するか、一致せずに報告されるかのどちらかである。
  - **ファイル全体を書き出す `Write` だけは拒否しない。** 再発行された `Write` は本文を照合しないので、そのターンの兄弟が適用した編集を無言で上書きしうる。根拠は `docs/maintainers/turn-batching-rationale.md` →「中断中のターンと `Write` の除外の根拠」。
  - **連続を切るのは「そもそもまとめられない呼び出し」、すなわち結果を次の呼び出しが必要とする委譲である。**
  - **`pnpm josh …` は読み取り専用サブコマンドの allow-list（`READ_JOSH_SUBCOMMANDS`）に載るものだけが bundleable である。** 書き込む・外部送信するサブコマンド（`run:progress --mark` はマーカーを書き、`notify` は送信し、`main:sync` / `epic` / `run:hold` は状態を書く）は allow-list に**入れない**。連鎖した行（`&&` / `|` / `>` など）は、先頭の `pnpm` が後続の変更を隠すため読みとしては信用せず、通常判定に落とす。
  - ツールを 1 つも呼ばないターンと、ガードが `off` のレーン子 — それぞれ下の「事後の計測」と「実装中の独立編集に効く合成コマンド」。

- **複数編集を 1 呼び出しにまとめるツールを前提にする。** 前提にできない。この repository が対象とする harness には常に存在するとは限らず、存在しない側では規則が一度も発火しない。`pnpm josh` はどの harness にも存在するので、書き込みは合成コマンド `pnpm josh edit:files` で畳む（下節）。経緯は `docs/maintainers/turn-batching-rationale.md` →「複数編集ツールの前提を joshuafolkken/kit#2366 が反証した経緯」。
- **ターンごとに件数の下限を課す。** 却下。依存が連続する区間では 1 件が正しい答えであり、下限は正しい振る舞いを罰する。上限も下限も持たないのが正しく、**代わりに事後の計測を置く**（次節）。

harness 側の一般的な指示（「依存のない呼び出しは同じブロックで出す」）は**すでに存在していて、実測では発火していなかった** — 4 本の run で 1 往復あたり 1.13 / 1.04 / 1.03 / 1.00 呼び出し。帰結は `docs/maintainers/turn-batching-rationale.md` →「一般指示が発火しなかったことの帰結」。

## 事後の計測 — 実行タイミングレポートの `Round trips:`

強制の代わりに、**結果が毎回の計測に出る。**

```
Round trips:
  tool calls                    104   over 153 turn(s)
  round trips                   104   1.00 calls per round trip
  ⚠ independent calls are going out one per turn (floor 1.50 calls per round trip)
```

- **round trip は「1 ターンがまとめて出した呼び出しのかたまり」1 つ**であって、呼び出し 1 件ではない。まとめて出せば呼び出し数はそのままで往復だけが減る — つまりこの数字は、仕事を減らさずに費用だけ下げたかどうかを直接見せる
- **しきい値は 1.50 呼び出し/往復。** 下回ると 1 行の指摘が出る。少しでもまとめている run は超えるので、これは程度を採点するのではなく**まとめていないこと**を検出する
- **`tool-less turns` の行は、ツールを 1 つも呼ばなかったターン数**（`turn_count − round_trips`、joshuafolkken/kit#1875）。`batch:guard` は発話だけのターンを拒否できない — 呼ぶツールが無く `PreToolUse` が発火しないので、唯一の梃子がこの事後計測である。`Bundling:` はこれを構造上見られない（まとめる対象を持たないターンは列に入らない）。発話だけのターンは自分で減らす（実測は `docs/maintainers/turn-batching-rationale.md` →「`tool-less turns` の実測」）
- 実装は `scripts/time-runtime/time-round-trips.ts`、詳細は `docs/josh-commands.md` の `time` コマンドの項

## 実装中の独立編集に効く合成コマンド（joshuafolkken/kit#2202）

**フックが届かない一区間が残っていた — レーン子の実装中の独立編集である。** レーン子（headless `claude -p`）ではガードが `off` なので（#2178）、別々のファイルへ `Read` → `Edit` を交互に出す並びは誰にも止められない。経緯は `docs/maintainers/turn-batching-rationale.md` →「合成コマンドに至った経緯（joshuafolkken/kit#2202）」。

**しかし 1 手前に確定している — Step 0 が変更ごとに対象ファイルを列挙する。** `pnpm josh read:files` はその点で読み取りを畳む合成コマンドである。`report-format.md` が Step 0 の継ぎ目（`josh lines` の隣）でランをここへ導く**手順**である。

**梃子の本体は読み取りと編集の脱交互化（de-interleave）。** 交互の並びで編集を分けているのは直前の読み取りへの依存で、読み取りを 1 回に畳めば続く別ファイルへの編集は互いにも直前の読み取りにも依存せず 1 ターンに載る。#2178 の並び — `Read A` / `Edit A` / `Read B` / `Edit B` … の **9 ターン** — が、`read:files A B C D` → `Edit A` ＋ `Edit B` ＋ `Edit C` ＋ `Edit D` の **2 ターン**になる。

上限超過時は `read:files` が「Read ツールで 1 ターンにまとめて読め」と返しフォールバックでも読み取りは畳まれたまま。詳細は `docs/josh-commands.md` →「`josh read:files`」。

書き込みは `pnpm josh edit:files` で畳む（joshuafolkken/kit#2366） — 編集を **プラン（`=====` のパスヘッダ＋ git conflict マーカー対）** として受け取り 1 呼び出しで適用し、各編集は content-addressed なので `old` が 1 箇所に一致しなければ拒否して報告する。#2493 で `-`（標準入力）を受け、依存編集は `dependent` で拒否する。詳細は `docs/josh-commands.md` →「`josh edit:files`」。

## ガード発火時にも合成コマンドを手渡す（joshuafolkken/kit#2311）

ガードが**単発の読み取り連続**で発火したとき、通知はその読み取りを畳む `pnpm josh read:files <path> …` を貼り付け可能な形で手渡す — モデルが 1 ターンで確実に出せる単一の呼び出しである。経緯は `docs/maintainers/turn-batching-rationale.md` →「ガード通知に合成コマンドを載せた経緯（joshuafolkken/kit#2311）」。

**読み取りに限り、2 件以上のときだけ。** 書き込みは `read:files` の対象外なので除外し、読み取り 1 件は既に単発なので畳むものがない。

**書き込み側も同じ地点で手渡す（joshuafolkken/kit#2366）。** 単発 `Edit` の連続でガードが発火したとき、通知はその編集を名指し、それらのファイルにわたる `pnpm josh edit:files` の畳み込みを添える（`write_fold_directive`）。読み取りはパスだけで畳めるが編集は本文を伴うので、貼り付け可能なのはコマンドとファイル名までで、プラン本体はモデルが書く — それでも並列 `tool_use` ブロックではなく 1 ターンで出せる単一呼び出しに落ちる。`Edit` だけを数え、content-address できない `Write`（既に独自の通知を持つ）は除く。

## なぜ resident ではなく引き金つき配送に置くか（joshuafolkken/kit#1524）

**この規則は常駐から外れている。** `pnpm josh batch:guard` が、単発呼び出しのターンが 3 つ続いた次の呼び出し（`Bash` / `Edit` / `Read`）を拒否し、そこで規則本文を突きつける — 規則が効く瞬間そのものである。配送の判定基準と機構は `rule-delivery.md` にある。

常駐から外した根拠は `docs/maintainers/turn-batching-rationale.md` →「常駐から外した根拠（joshuafolkken/kit#1524）」。

**引き金が発火しないターンでは何も起きず、それが正しい。** 発火しないということは往復あたりの呼び出し数が下限（1.50）を上回っているということであり、規則が守られている状態と一致する。

配送文（`scripts/time-runtime/time-batch-guard.ts` の `REASON`、および `time-density.ts` の実行時 1 行）が運ぶのは次の 2 点である。常駐側に残していたのと同じ内容であり、削っていない。

1. 別の呼び出しの結果に依存しない呼び出しは、同じターンに載せる
2. 判断基準は「依存の有無」であって呼び出しの種類ではない（読み取りも編集も同じ）。かつ、往復を減らすことは仕事を減らすことではない

実測値・却下した機構案・計測の読み方はこのファイルと `docs/maintainers/turn-batching-rationale.md` にあり、配送文からは落としている。

## マーカーテスト

`scripts/rules/turn-batching-rule.test.ts` が固定する。内訳は `docs/maintainers/turn-batching-rationale.md` →「マーカーテストが固定するもの」。
