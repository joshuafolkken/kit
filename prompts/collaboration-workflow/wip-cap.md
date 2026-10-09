# オープン Issue の WIP 上限

**単一ソースはこのファイルである。**

**この規則は常駐しておらず、配送もされない — 起票するコマンドそのものが守らせる**（joshuafolkken/kit#1524 で常駐を外し、その後 `rule:guard` の配送行も外した）。`pnpm josh issue:file` が起票の前に件数を数え、上限を超えて免除が無ければ何も送らずに保留し、そこで拒否・2 つの免除・免除を決める 3 条件を印字する（`gh issue create` や `…/issues` への `title` 付き POST による直接起票は `direct-filing` が毎回拒否するので、起票は必ずこのコマンドを通る）。事前の拒否と出し直しの往復は無い。保留文の実体は `scripts/issue/issue-wip.ts` の `HELD_MESSAGE` にある（固定するテストは `docs/maintainers/wip-cap-rationale.md` → "Tests that pin the wording"）。

背景・測定・経緯は保守者向けの文書にあり（上限が要る理由は `docs/maintainers/wip-cap-rationale.md` → "Why a cap is needed — the measurement"）、ラン中に読む必要はない。

## 規則

**オープン Issue が上限を超えている状態で新しく起票するときは、先に 1 件閉じる。**

**件数は `pnpm josh issue:file` が起票の前に数える**（joshuafolkken/kit#3181）。手で数えることも、見積もりや記憶で済ませることもない。数え方・印字・保留の詳細は `docs/josh-commands-backlog.md` → "`josh issue:file`" にある。

- **上限は 30。** これを超える 1 件を作る前に 1 件閉じる。エージェントが読む文書（`CLAUDE.md`・`prompts/`・配布 skill）がこの数字を書くのはこの行だけで、一次情報は `scripts/issue/issue-wip.ts` の `WIP_CAP` である（一致はテストが固定する）。
- コマンドは起票先（`--repo` を付ければそのリポジトリ）のオープン Issue を epic も含めて数え、`wip:` 行に件数・上限・判定を印字する。上限を超えて免除が宣言されていなければ**何も送らずに保留し、免除の問いを印字する**。
- **免除を宣言するのはこのファイルの判断である** — `--route interrupt`（下の 3 条件）、`--route split` / `--route tier-a`（実行が詰まる起票）はルートそのものが宣言になる。ルートの無い実行が詰まる起票（利用者が `new` と打った入口など）は `--over-cap` を付けて出し直す。裁量起票（`--route review-cap` を含む）に `--over-cap` を付けてはならない。

## 超過時の手順

起票しようとした時点で上限を超えていたら、**その起票が裁量によるものか、実行がそれに詰まっているか、割り込みか**の 3 つに分岐する。判断ではなく、起票の種類で決まる。**上限が効くのは裁量側だけである。**

**判定するのは「起票 1 件」ではなく「起票のひとまとまり」である。** 分割判定が作る子 N 件とその epic、割り込み Issue とその上流バックリンク、起票直後の `epic:bundle` が `create_epic` と答えたときの epic — これらは 1 回の起票行為であり、途中で上限に当たって半分だけ作るのが最悪の結果になる。**ひとまとまりの先頭で 1 回だけ判定し、通ったらまとまり全体を作り切る。**

### 裁量起票 — 上限が効く側

レビュー上限の branch 2 と、思いついた改善や気付きの記録。**起票しなくても現在の実行が完了するもの**が該当する。

1. **まず 1 件閉じる。** 閉じてよいのは、実際に終わっているもの・重複・別の Issue に取って代わられたもの・もう要らないと判断できるものだけである。クローズコメントにどれに当たるかを 1 行書く。
2. **正直に閉じられるものが無いなら、起票しない。** 場所を空けるために、まだ意味のある Issue を閉じてはならない。それは上限を満たしたことにはならず、記録を壊すだけである。
3. **起票しない場合、その指摘は起票以外の出口を取る。** レビュー指摘なら branch 3（PR 本文に 1 行残して落とす）である。**これは既定の出口であり、上限に阻まれたときの代替ではない。**

### 実行が詰まる起票 — 上限が効かない側

前提 Issue（`prerequisite.md`）、別パッケージ起因の割り込み Issue、ユーザーが `new` と打った入口、`issue:scout` が重複無しと答えた新規作業、**そして分割判定が作る子 Issue と epic**。**これらは起票しないと実行が進まない。**

- **上限を理由に止めない。** 理由は `docs/maintainers/wip-cap-rationale.md` → "Why a filing a run is blocked by is not stopped"。
- **分割の子がここに入る理由**: 分割を検出した `fullrun` / `halfrun` は「子と epic を起票して **STOP**」と定められている（`fullrun.md` / `halfrun.md`）。**分割するかどうかを決めるのは分割判定の側**で、既定はもう「分割しない」に上がっている — 上限が二重に効く必要はない。
- **超過した事実は完了報告に 1 行書く**（例: 「オープン 34 件で起票した」）。上限は可視化のための装置なので、超えたことが見えていれば役割は果たしている。

### 割り込み起票 — 上限が効かない側（3 条件で機械的に決める）

**重大な欠陥の発見は、それが現在のランを止めていなくても捨ててはならない。** 上限の目的は増加を見えるようにすることであって、**発見を捨てることではない**（`docs/maintainers/wip-cap-rationale.md` → "Why a cap is needed — the measurement"）。由来は `docs/maintainers/wip-cap-rationale.md` → "Where the interrupt category comes from"。

**別パッケージ起因の割り込みとは別の区分である。** あちらは上流リポジトリへ起票して停止する手順（`upstream-interrupt.md`、`route:tier-a`）で、実行が詰まる側に属する。ここで言う割り込みは、**このリポジトリの欠陥で、発見したランをブロックしていないもの**を指す。

#### 3 条件 — 該当するかは判断ではない

**次の 3 つのいずれかを満たすかどうかだけで決める。**

1. **検証が誤った答えを返す** — 緑であってはならないものが緑になる、または無実の変更が赤にされる
2. **文書化された作業手順が完了できなくなる** — 並列レーン、`josh propagate` など、ドキュメントに書かれた手順が現状のコードでは通らない
3. **データが失われる、またはリポジトリの外に書き込む**

**3 つのいずれにも当たらない発見は、従来どおり裁量側の出口を取る。** 改善案、設計上の好み、未検証の疑い、「あとで直したい」はここに入らない — レビュー指摘なら branch 3（PR 本文に 1 行残して落とす）であり、それは既定の出口であって上限に阻まれたときの代替ではない。

**深刻さの自己申告は条件ではない。** 理由は `docs/maintainers/wip-cap-rationale.md` → "Why self-reported severity is not a condition"。

#### 該当したときの手順

1. **上限に関係なく起票する。** 1 件閉じることを条件にしない。起票は `pnpm josh issue:file` で行う。本文の検査、本文が宣言する分類ラベルの付与、重複探し、`epic:bundle` はこのコマンドが実行する（`docs/josh-commands-backlog.md` → `josh issue:file`）。

   ```bash
   pnpm josh issue:file "<title>" --body-file <body-file> --depth <n> --route interrupt
   ```

2. **超過している事実と、当たった条件の番号を本文に 1 行書く**（例:「オープン 37 件で起票。3 条件のうち 2（文書化された手順が完了できない）に該当」）。**どちらか一方では足りない** — 件数だけでは判定が再現できず、条件だけでは上限の可視化が効かない。
3. **次に実行されるものとして挿入する。** epic の下にあるなら `pnpm josh epic --add <E> <N>` で、**位置を指定せずに**追加する（`<E>` が epic、`<N>` が起票した割り込み）。**`--before` / `--after` を使ってはならない。** それらは `blocked-by` を書き込み、「発見したランをブロックしていない欠陥」という割り込みの定義と矛盾する**偽の依存関係**になる。**順序は実行側が持つ** — 先に提示させたいときは、行だけを動かす `--order-before <M>` を使う。仕組みと経緯は `docs/maintainers/wip-cap-rationale.md` → "Why an addition names no position"。**epic の下に無いなら挿入先そのものが無い**ので、この手順は飛ばして 4 だけを行う。
4. **着手は、既にある承認の内側でのみ、指示を待たずに行う。** `backlogrun` の中なら、打たれたキーワードがバッチを承認しているので、割り込みは次の子として着手してよい。**バッチの外では `CLAUDE.md` →「Explicit invocation required」が変わらず効く** — 起票と挿入まで済ませたうえで、利用者に打つべきコマンド（`fullrun #<N>`）を報告して止まる。**割り込みは上限の例外であって、明示起動規則の例外ではない。**

**起票と、実行されるようにするところまでが 1 つのまとまりである。** epic の下にある割り込みを起票だけして追加しなければ、`epic:next` はそれを候補にすら出さない — Issue は残るが実行されないという、コメントに埋もれるのと大差ない状態になる。**epic の外にある割り込みでは、まとまりの後半は 4 の報告そのもの**であり、打つべきコマンドを利用者に渡すまでが 1 回の行為である。上の「ひとまとまりで判定する」がここにも効く。

**割り込みをバッチの中で単独で走らせるか、並列のレーンで走らせるか**は `.claude/skills/workflow-commands/backlogrun-lanes.md` → "A solo run" が単一ソースである（理由は `docs/maintainers/wip-cap-rationale.md` → "Why a solo run"）。上限の数字の変え方は `docs/maintainers/wip-cap-rationale.md` → "Changing the cap itself"、上限が分割判定・レビュー上限と一緒に動く理由は `docs/maintainers/wip-cap-rationale.md` → "The three move together"と `docs/maintainers/wip-cap-rationale.md` → "Why the three landed in one commit"にある。
