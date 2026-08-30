## `owner/repo#` — 実行対象のリポジトリを入口で指定する

`kickoff` / `fullrun` / `halfrun` / `queue` / `epicrun` は、対象リポジトリを受け取る手段を持っていなかった。`kickoff.md` の起票コマンドは 3 か所とも対象リポジトリを指定しておらず、**起票先は常に「セッションが動いているリポジトリ」になる**。別リポジトリのセッションで課題を検討し、その結論を対象パッケージへ起票する — この使い方は例外ではなく日常であり、そのたびに人が口頭で起票先を指示していた（joshuafolkken/kit#904）。

記法の先例は既にあった。`epicrun joshuafolkken/kit#858` は別リポジトリの EPIC を指す正しい書式として定義済みで、**入口だけがこの記法から取り残されていた**。したがって定義は本節に 1 つだけ置き、全ての入口がそれを参照する（joshuafolkken/kit#865 が分割判定に対して行った是正と同じ形）。運用手順は `.claude/skills/workflow-commands/SKILL.md` → 「2c. The `owner/repo#` prefix」にある。

### 書式 — Issue 参照の前に `owner/repo` を置く

```
kickoff joshuafolkken/kit#412
kickoff kit#new
kickoff kit#new "<title>"
fullrun joshuafolkken/app-kit#12
halfrun kit#412
queue kit#1 kit#2
epicrun joshuafolkken/kit#858
```

`#N` が入る位置に `owner/repo#N` を置くだけであり、**新しいキーワードは増えない**。`new` は番号の代わりにその位置へ置かれるものなので、`owner/repo#new` は `owner/repo#N` と同じ形で成り立つ。

**`into <target>` とは独立した修飾である。** 前置きは「このランがどのリポジトリに対して動くか」、`into` は「作った成果物をどの EPIC へ入れるか」を言う。両方に修飾が必要なこともある — `kickoff kit#new into joshuafolkken/kit#909` は正しい 1 行である。

### 短縮名は owner を前置して展開する（マップは引かない）

`kit#new` は、**セッションが動いているリポジトリの owner を前置して**展開する（`gh api repos/{owner}/{repo} --jq .owner.login`）。joshuafolkken/kit#869 の発見マップは引かない — マップが答えるのは「チェックアウトがどこにあるか」であって「どのリポジトリを指しているか」ではなく、**チェックアウトが無いリポジトリも `kickoff` の対象としては正しい**からである。

**短縮名が third-party に解決される経路は構造上存在しない。** first-party の判定は owner の一致だけであり（`CLAUDE.md` → 「Third-party repositories are Tier C」）、セッションの owner を前置して作った名前はその判定を定義から満たす。`repo_map_logic.is_same_owner` が発見マップの全エントリに対して置いている関門と同じ基準である。**これは短縮名についてのみ成り立つ主張であり、owner を明示した完全形には当てはまらない** — 次節がその場合を定める。

**裸の `#N` を禁じる既存規則とは別の話である。** 禁じられているのは裸の **Issue 番号**（同じ番号の別 Issue へ黙って解決される）であり、owner が一意に定まる裸の**リポジトリ名**にはその失敗モードが無い。

存在しないリポジトリ名は `gh` が not found で失敗する。**近い名前に読み替えてはならない** — 打ち間違いを黙って直すと、人が指していないリポジトリへ書き込むことになる。失敗をそのまま報告して止まる。

### 別 owner を明示したら third-party — Tier C として止まる

`sveltejs/svelte#new` のように**セッションのリポジトリと owner が異なる**完全形は、third-party の指定である。判定は機械的に行う — `gh api repos/{owner}/{repo} --jq .owner.login` が返す owner と一致するかどうかだけであり、判断を挟まない。

**third-party への書き込みは Issue・コメント・PR のいずれも Tier C であり、そのターンでの明示指示が無ければ実行してはならない**（`CLAUDE.md` → 「Third-party repositories are Tier C」）。前置きが打たれたことは指示ではない — 指しているリポジトリを言っただけで、他人のトラッカーへ書いてよいとは言っていない。

**入口で third-party を指された時点で取る行動は 1 つだけである — `confirmation` の Telegram を送って止まる。** ここではまだ何も作っておらず、記録すべき所見も下書きも存在しないので、`## Upstream candidate` に書けるものは無い（あれは**実行中に上流の欠陥を見つけた場合**の手順であり、入口の指定には掛からない）。人がそのターンで明示的に「そこへ出してよい」と言ったときに初めて、Tier C の起票手順に入る。

**`-R` を付ければ技術的には書ける、ということは許可ではない。** 出て行く先は他人のトラッカーであり、通知も索引も後から取り消せない。

### 省略時は現行どおり

前置きが無ければ対象はセッションのリポジトリである。**既存の打鍵は 1 つも意味が変わらない。**

### 計画のみの入口（`kickoff`）— チェックアウトは要らない

`kickoff` は起票と計画コメントで完結するので、**読み取りを含む全ての `gh api` 呼び出しのパスに `repos/<owner/repo>/…` を書けば足りる** — Issue の読み取り・作成・更新・コメント・ラベル作成のいずれもである。**読み取りにこそ付け忘れやすく、付け忘れは黙って通る**：`kickoff joshuafolkken/kit#412` の 1 手目でパスを `repos/{owner}/{repo}/issues/412` のままにすると、自リポジトリの別 Issue を読んで計画を書くことになり、エラーは出ない。クローンは不要であり、行ってはならない。

**例外は分割パスの EPIC 作成である。** `pnpm josh epic` は自分が走っているリポジトリしか読み書きしない（`into-epic.md` の `epic --add` と同じ制約）。子は `gh api repos/<owner/repo>/issues` で作れるので、EPIC だけが次の 2 通りになる。

- 対象リポジトリのチェックアウトがあれば、**そこで** `pnpm josh epic` を実行する（場所は `pnpm josh doctor` が印字する）
- 無ければ `kickoff.md` が既に定める手動フォールバック（`gh api repos/<owner/repo>/issues -f title="<epic-title>" -f 'labels[]=epic' -f body="<body>"`）で作り、**`pnpm josh epic:check` を回せなかったことを報告する** — 検査していないものを検査済みとして報告しない
- **昇格（`pnpm josh epic --promote`）を選ぶ分岐には、この手動フォールバックが無い。** `--promote` も自分が走るリポジトリしか書き換えないうえ、起票で代用すると `#N` は昇格も子への参加もしないまま取り残される。チェックアウトが無ければ、子を作った時点で**停止して報告する**

### 実装を伴う入口（`fullrun` / `halfrun` / `queue`）— チェックアウト必須、勝手に clone しない

実装・コミット・PR は対象リポジトリの作業ツリーでしか行えない。**掛かるのは対象がセッション自身のリポジトリでない場合だけである** — 短縮名で自分のリポジトリを指した `fullrun kit#412` は従来の `fullrun #412` と同じ扱いであり、作業ツリーの退避も各入口の手順のままである。別リポジトリを指したときだけ、順に判定する。

1. チェックアウトの場所を `pnpm josh doctor` の地図から引く（joshuafolkken/kit#869）
2. **無ければ停止して報告する。勝手に clone してはならない。** kit#869 が「チェックアウトが無いリポジトリは clone せずそう表示する」と定めたのと同じ判断であり、勝手に clone することは人の作業機の配置を勝手に決めることである。`confirmation` の Telegram を送って止まる
3. **対象の作業ツリーが clean でなければ停止して報告する。** そこに残っている変更は自分が作ったものではないので、stash も破棄もしない。**各入口の「作業ツリーに変更があれば `git stash`」の手順が掛かるのはセッション自身のリポジトリだけ**であり、他人のチェックアウトには掛からない
4. clean なら、**対象リポジトリに対して働くコマンド**（`git switch main && git pull` から `pnpm josh followup --merge` まで）を、そのチェックアウトを作業ディレクトリとして実行する。セッション自身のリポジトリには触れない。**別のリポジトリを名指しするコマンドはこの限りではない** — `into joshuafolkken/kit#909` の挿入は `pnpm josh epic --add` が自分の走るリポジトリしか読み書きしないため、EPIC のある側のチェックアウトで実行する（`into-epic.md`）

### `epicrun` の前置きは EPIC の在り処だけを指す

`epicrun owner/repo#E` が名指すのは **EPIC の所在**であって、子を実装するリポジトリではない。**したがって上の 1〜4 は `epicrun` の起動には掛からない** — EPIC の状態はそのリポジトリを指定した REST パスで読めるため、そのリポジトリのチェックアウトは要らず、無くても、汚れていても、起動は止まらない（`.claude/skills/workflow-commands/epicrun.md` → 「Concurrency」）。

チェックアウトが要るのは**子を実装する段**であり、そこで掛かるのは**その子のリポジトリ**に対する 1〜4 である。どのセッションがどの子を実行するかは同節（リポジトリごとに 1 セッション）が決める。本節が `epicrun` に与えるのは EPIC をどう指すかの記法だけであり、子の実装先を上書きしない。

### `CLAUDE.md` には常駐させない

この記法が効き始めるのは**キーワードが打たれた後**であり、その時点で workflow skill は必ず読まれている（`CLAUDE.md` → 「Read the skill before running any part of a command」）。常駐判定の問いは「skill を読んでいないターンで発火する必要があるか」であり、答えは no である（`residency.md`）。`into <target>`（joshuafolkken/kit#985）が skill と正典だけに置かれているのと同じ理由で、本節も常駐しない。
