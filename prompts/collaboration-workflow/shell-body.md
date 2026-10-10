## 本文をシェルの二重引用符に載せない（joshuafolkken/kit#1198）

「本文をシェルの二重引用符に載せない」規則の単一ソース（`CLAUDE.md` からは [`rule-delivery.md`](./rule-delivery.md) →「配送されている規則」を経て届く）。「ファイル本文をシェルに載せない」（[`file-edits.md`](./file-edits.md)）と対になる規則である。**あちらは「ファイルの中身をシェルに載せるな」、こちらは「本文をシェルに載せるな」** であり、禁じている理由が違う — あちらはコストの二重払い、こちらは**テキストが実行されること**である。

### 何が起きるのか

シェルの二重引用符の中では、バッククォートはコマンド置換として、`$` は変数展開として**コマンドが走る前に評価される**。したがって次の呼び出しは、本文を投稿しない。

```bash
gh api repos/{owner}/{repo}/issues/1535/comments -f body="… `pnpm josh ms` は …"
```

zsh は `pnpm josh ms` を実行し、その標準出力を本文に埋め込む。`pnpm josh followup --notify-message "…"` の本文も同じ根で壊れる。事故の経緯は `docs/maintainers/shell-body-rationale.md` → "The incidents — two kinds of damage, one cause"。

- **通知経路**: 置換結果が本文に混ざる。壊れ方が静かで、`followup` は正常終了する
- **`gh` 経路**: 置換された結果が捨てられるのではなく、**コマンドとして実行される**

**発火するのは `` ` `` と `$` であって `!` ではない**（実測表は `docs/maintainers/shell-body-rationale.md` → "Why `!` is not a trigger"）。

### 安全な書き方

**本文をファイルに書いて、パスで渡す。** シェルは本文を一切解釈しない。

```bash
pnpm josh issue:comment <N> --body-file <path>
gh api -X PATCH repos/{owner}/{repo}/issues/<N> --field body=@<path>
pnpm josh followup "<title> #<N>" --notify-message-file <path>
pnpm josh notify --task-type confirmation --issue-url "<url>" --body-file <path>
```

**PR コメントも同じ経路である** — REST では pull request のコメントは issue のコメントであり、`pnpm josh issue:comment <N> --body-file <path>` がそのまま使える。`gh issue comment` / `gh pr comment` は使わない（GraphQL 経由。理由は `docs/maintainers/shell-body-rationale.md` → "Why no `gh` subcommand is written in an executable block"）。

### コメント投稿は `pnpm josh issue:comment` の 1 綴りだけ（joshuafolkken/kit#2304）

**`gh api` には「本文をパスで渡す」の綴りが 2 つあり、片方は黙って壊れる。**

- `gh api ... -F body=@<path>` ／ `--field body=@<path>` — `@` で始まる値を**ファイルとして読む**。正しい
- `gh api ... -f body=@<path>` ／ `--raw-field body=@<path>` — 値を**そのまま送る**。`@<path>` というリテラル文字列がコメントとして投稿される

`-f` と `-F` は 1 文字違いで、どちらでも `gh` は終了コード 0 でコメント URL を返す。**壊れたことが分かるのは後で人が Issue を見たときだけ**である（`docs/maintainers/shell-body-rationale.md` → "The comments lost to `-f body=@`"）。

だから **Issue／PR コメントの投稿は `pnpm josh issue:comment <N> --body-file <path>` ただ 1 綴りに寄せる** — 間違ったフラグを選ぶ余地が無く、本文は `cli-body.ts` を通ってパスで渡るためシェルも評価しない。`-f body=@…` の綴りは実行前に `pnpm josh rule:guard` が拒否する（列挙表の `raw-field-body` 行、`scripts/rules/raw-field-body.ts`）。上の Issue body 書き換え（`-X PATCH ... --field body=@<path>`）は `-F` 側で安全なので綴りを変えない。

`--body-file` / `--notify-message-file` はいずれも `-` で標準入力を読む（`gh issue create --body-file -` と同じ約束）。読み取りは `scripts/josh/cli-body.ts` の 1 本だけで、`josh notify` / `josh followup` / `epic --rationale-file` / `epic --decision-file` の 4 つがそれを共有する。**`--body` と `--body-file` の同時指定は拒否する**（`docs/maintainers/shell-body-rationale.md` → "Why `--body` and `--body-file` together are refused"）。

**`$'…'` も安全である。** ANSI-C クォートの中ではコマンド置換も変数展開も起きない。`CLAUDE.md` が Telegram の本文に `--body=$'…'` を指定しているのはそのためであり、この規則はそれを置き換えるものではない。ただし本文が長くなるほどファイルの方が扱いやすい。

### 引き金つき配送

`pnpm josh rule:guard` が、二重引用符の本文値にバッククォートか `$` が実際に含まれる `Bash` 呼び出しを拒否して本文を突きつける。拒否されたら本文をファイルに移して出し直す。**引き金が見えない綴り（`-b`・`-f title=` など）でも、フックが走らないエージェントでも規則は同じく拘束する。** 配線と見えない綴りの一覧は `docs/maintainers/shell-body-rationale.md` → "Why it is a triggered delivery"、引き金の設計は `docs/maintainers/shell-body-rationale.md` → "Why the trigger reads the body, not the flag"、固定しているテストは `docs/maintainers/shell-body-rationale.md` → "Marker tests"。
