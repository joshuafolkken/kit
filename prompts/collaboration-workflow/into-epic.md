## `into <target>` — 作った Issue をその場で EPIC へ入れる

`kickoff new` / `fullrun new` / `halfrun new` は Issue（分割時は EPIC）を作るが、**それをどの EPIC にぶら下げるかを指示しない**。そのため利用者は毎回、キーワードに続けて同じ 3 行を手で打っていた（joshuafolkken/kit#985）。

```
kickoff new
作成した issue を、#909 の最適な位置に挿入してください。
EPIC を作成した場合は、EPIC を #909 の最適な位置に挿入してください。
```

**打ち忘れた回の Issue はどの EPIC にも属さない。** `epic:next` は EPIC の子しか提示しないため、その Issue は二度と実行されない — 捨てられたのではなく、永久に park された状態になる。

### 書式

```
kickoff new into #909
fullrun new into #909
halfrun new into #909
kickoff new "<title>" into #909
kickoff new into joshuafolkken/kit#909
```

**`into` を選んだ理由は、他の綴りが既存の書式と衝突するからである。** `kickoff new #909` は既存 Issue を指す `kickoff #N` と読めてしまい、`kickoff new epic #909` は「新しい EPIC を作る」と読める（実際には作られるのが Issue 1 件のこともある）。`into` は「作ったものを #909 へ入れる」としか読めず、単独 Issue でも EPIC でも同じ 1 文が成り立つ。

**接尾辞が無いときの挙動は変わらない。** 従来どおり、作った Issue はどの EPIC にも入らない。

### 入るのは「そのランが作った最上位の成果物」1 つだけ

分割が起きなければ**作成した Issue**、分割が起きれば**作成した EPIC** が入る。子は EPIC が持つので指定先には入らない。上の 3 行が場合分けしていた点は、この 1 文に畳まれている。

### 入れるのは作成直後、実装の前

**成果物が存在した時点で入れる** — `fullrun new` なら実装より前、`kickoff new` なら計画コメントより前である。実装の後に回すと、途中で止まったランが「どの EPIC にも属さない Issue」をちょうど残す。それはこの接尾辞が無くす対象そのものである。

### 位置は自動で決めず、根拠を残す

挿入は必ず `pnpm josh epic --add <E> <N> [--before <M> | --after <M>]` を通す。**本文を手で編集してはならない** — 宣言と `blocked-by` が食い違い、`epic:next` が `error` を返して無人実行が止まる。

位置の判断は対象 EPIC が既に採ってきた基準に従う（効果が残りの実行単位に比例して複利で効くものほど前へ、作業中の子は横取りしない）。**その根拠は対象 EPIC の本文か Issue コメントに残す** — 会話にしか無い根拠は、次に順序を疑う人には存在しないのと同じである。

### 指定先が EPIC でないとき — 断る。昇格を勝手に行わない

`pnpm josh epic --add` は `epic` ラベルを持たない Issue を拒否し、**取るべき対処を 2 つとも名指しする**。

- 指定先が要望・議論・容れ物なら `pnpm josh epic --promote <N> <N...>` で昇格する
- 指定先自身が成果物の 1 つなら、両方を子とする新しい EPIC を作る

**コマンドが勝手に昇格しない理由**は、昇格が他人の Issue を容れ物へ書き換える構造変更であり、2 つのうちどちらが正しいかは指定先が何であるかに依るからである（`.claude/skills/workflow-commands/split-assessment.md` の promote-or-create と同じ分岐）。断り文句が対処を名指しするので、ランは 1 コマンドで先へ進める。

### 別リポジトリの EPIC を指したとき

`into owner/repo#N` は正しい書式である。ただし `pnpm josh epic --add` は**自分が走っているリポジトリの Issue しか読み書きしない**ため、そのリポジトリのチェックアウトで実行する。誤ったリポジトリで実行した場合、コマンドは使い方の一覧ではなく**打ち直すべきコマンドそのもの**を返す。

```
✖ joshuafolkken/kit#909 is an epic in another repository; ...
  Run `pnpm josh epic --add 909 985` in that repository's checkout (`pnpm josh doctor` prints where each one is).
```

チェックアウトの場所は `pnpm josh doctor` が印字する（`cross-repo-epic.md`）。**別リポジトリの EPIC を `#N` と書いてはならない** — その番号は自リポジトリの別 Issue に解決する。

### `epic:bundle` との違い

`epic:bundle` は「関連する Issue が既にあるか」を**推薦する**コマンドであり、`into` は人が**明示指定する**経路である。推薦は信号が弱ければ何もしないが、明示指定はそれ自体が信号であり、迷わない。両者は別の経路であり、`into` があっても起票直後の `epic:bundle` は従来どおり実行する。
