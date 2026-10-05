## 本文をシェルの二重引用符に載せない（joshuafolkken/kit#1198）

`CLAUDE.md` →「Never put a body in shell double quotes」の単一ソース。隣にある「Never carry a file's new text inside a shell command」（[`file-edits.md`](./file-edits.md)）と対になる規則である。**あちらは「ファイルの中身をシェルに載せるな」、こちらは「本文をシェルに載せるな」** であり、禁じている理由が違う — あちらはコストの二重払い、こちらは**テキストが実行されること**である。

### 何が起きるのか

シェルの二重引用符の中では、バッククォートはコマンド置換として、`$` は変数展開として**コマンドが走る前に評価される**。したがって次の呼び出しは、本文を投稿しない。

```bash
gh api repos/{owner}/{repo}/issues/1535/comments -f body="… `pnpm josh ms` は …"
```

zsh は `pnpm josh ms` を実行し、その標準出力を本文に埋め込む。`pnpm josh followup --notify-message "…"` の本文も同じ根で壊れる。事故の経緯は `docs/maintainers/shell-body-rationale.md` →「事故の経緯 — 二つの被害、一つの原因」。

- **通知経路**: 置換結果が本文に混ざる。壊れ方が静かで、`followup` は正常終了する
- **`gh` 経路**: 置換された結果が捨てられるのではなく、**コマンドとして実行される**

### 実測 — 発火するのは `` ` `` と `$` であって `!` ではない

本リポジトリの実行環境（非対話 zsh）で確かめた結果は次のとおりである。

| 文字            | 二重引用符の中で                                     |
| --------------- | ---------------------------------------------------- |
| `` ` ``         | **発火する**（コマンド置換）                         |
| `$`             | **発火する**（変数展開）                             |
| `!`             | 発火しない（履歴展開は非対話では無効）               |
| `\$` / `` \` `` | 発火しない（直前のバックスラッシュがリテラル化する） |

`!` は引き金に入れていない。理由は `docs/maintainers/shell-body-rationale.md` →「`!` を引き金に入れない理由」。

### 安全な書き方

**本文をファイルに書いて、パスで渡す。** シェルは本文を一切解釈しない。

```bash
pnpm josh issue:comment <N> --body-file <path>
gh api -X PATCH repos/{owner}/{repo}/issues/<N> --field body=@<path>
pnpm josh followup "<title> #<N>" --notify-message-file <path>
pnpm josh notify --task-type confirmation --issue-url "<url>" --body-file <path>
```

**PR コメントも同じ経路である** — REST では pull request のコメントは issue のコメントであり、`pnpm josh issue:comment <N> --body-file <path>` がそのまま使える。`gh issue comment` / `gh pr comment` は使わない（GraphQL 経由。理由は `docs/maintainers/shell-body-rationale.md` →「`gh` サブコマンドを実行可能ブロックに書かない理由」）。

### コメント投稿は `pnpm josh issue:comment` の 1 綴りだけ（joshuafolkken/kit#2304）

**`gh api` には「本文をパスで渡す」の綴りが 2 つあり、片方は黙って壊れる。**

- `gh api ... -F body=@<path>` ／ `--field body=@<path>` — `@` で始まる値を**ファイルとして読む**。正しい
- `gh api ... -f body=@<path>` ／ `--raw-field body=@<path>` — 値を**そのまま送る**。`@<path>` というリテラル文字列がコメントとして投稿される

`-f` と `-F` は 1 文字違いで、どちらでも `gh` は終了コード 0 でコメント URL を返す。**壊れたことが分かるのは後で人が Issue を見たときだけ**である（`docs/maintainers/shell-body-rationale.md` →「`-f body=@` で失われたコメント」）。

だから **Issue／PR コメントの投稿は `pnpm josh issue:comment <N> --body-file <path>` ただ 1 綴りに寄せる** — 間違ったフラグを選ぶ余地が無く、本文は `cli-body.ts` を通ってパスで渡るためシェルも評価しない。`-f body=@…` の綴りは実行前に `pnpm josh rule:guard` が拒否する（列挙表の `raw-field-body` 行、`scripts/rules/raw-field-body.ts`）。上の Issue body 書き換え（`-X PATCH ... --field body=@<path>`）は `-F` 側で安全なので綴りを変えない。

`--body-file` / `--notify-message-file` はいずれも `-` で標準入力を読む（`gh issue create --body-file -` と同じ約束）。読み取りは `scripts/josh/cli-body.ts` の 1 本だけで、`josh notify` / `josh followup` / `epic --rationale-file` / `epic --decision-file` の 4 つがそれを共有する。**`--body` と `--body-file` の同時指定は拒否する**（`docs/maintainers/shell-body-rationale.md` →「`--body` と `--body-file` の同時指定を拒否する理由」）。

**`$'…'` も安全である。** ANSI-C クォートの中ではコマンド置換も変数展開も起きない。`CLAUDE.md` が Telegram の本文に `--body=$'…'` を指定しているのはそのためであり、この規則はそれを置き換えるものではない。ただし本文が長くなるほどファイルの方が扱いやすい。

### 引き金つき配送

`pnpm josh rule:guard` が、二重引用符の本文値にバッククォートか `$` が実際に含まれる `Bash` 呼び出しを拒否して本文を突きつける。拒否されたら本文をファイルに移して出し直す。配線は `docs/maintainers/shell-body-rationale.md` →「引き金つき配送にした理由」、引き金の設計は `docs/maintainers/shell-body-rationale.md` →「引き金をフラグでなく本文で引く理由」、固定しているテストは `docs/maintainers/shell-body-rationale.md` →「マーカーテスト」にある。

### 引き金が見えないもの

- **node の中から REST で投稿する経路**（`pnpm josh propagate` など）はシェル文字列に現れない
- **`gh api --input <file>`** は本文がファイルにあるため、そもそも安全である
- **`-b`（GitHub CLI の `--body` の短縮形）は覆っていない** — 同じ綴りが `git checkout -b` のブランチ名でもあり、そこで拒否するのは誤ったターンでの発火になる
- **`-f title="…"`** は覆っていない。タイトルは英語へ正規化された短い語であり、バッククォートを含む運用がない

引き金が見えない綴りでも規則は同じく拘束する。フックが走らないエージェントも同じである。
