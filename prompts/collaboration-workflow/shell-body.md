## 本文をシェルの二重引用符に載せない（joshuafolkken/kit#1198）

`CLAUDE.md` からは [`rule-delivery.md`](./rule-delivery.md) →「配送されている規則」を経て届く。[`file-edits.md`](./file-edits.md) が防ぐのはコストの二重払い、こちらが防ぐのは**テキストが実行されること**である。

### 何が起きるのか

二重引用符の中のバッククォートと `$` は実行前に評価される。次の呼び出しは `pnpm josh ms` を実行し、その出力を本文に埋め込む。

```bash
gh api repos/{owner}/{repo}/issues/1535/comments -f body="… `pnpm josh ms` は …"
```

`pnpm josh followup --notify-message "…"` も同じく壊れる。

発火するのは `` ` `` と `$` で、`!` ではない。

### 安全な書き方

**本文をファイルに書いて、パスで渡す。**

```bash
pnpm josh issue:comment <N> --body-file <path>
gh api -X PATCH repos/{owner}/{repo}/issues/<N> --field body=@<path>
pnpm josh followup "<title> #<N>" --notify-message-file <path>
pnpm josh notify --task-type confirmation --issue-url "<url>" --body-file <path> --recommended "<choice>"
```

PR コメントも `pnpm josh issue:comment <N> --body-file <path>` で投稿する（REST では PR コメントは issue コメント）。`gh issue comment` / `gh pr comment` は使わない。

### コメント投稿は `pnpm josh issue:comment` の 1 綴りだけ（joshuafolkken/kit#2304）

`gh api` の `-f body=@<path>` ／ `--raw-field body=@<path>` は `@<path>` というリテラルを黙って投稿する。**Issue／PR コメントの投稿は `pnpm josh issue:comment <N> --body-file <path>` ただ 1 綴りに寄せる。** `-f body=@…` は `pnpm josh rule:guard` が実行前に拒否する（`raw-field-body` 行、`scripts/rules/raw-field-body.ts`）。Issue body 書き換えの `-X PATCH ... --field body=@<path>` は `-F` 側で安全なのでそのまま使う。

`--body-file` / `--notify-message-file` は `-` で標準入力を読む（実装は `scripts/josh/cli-body.ts`）。`--body` と `--body-file` の同時指定は拒否される。

**`$'…'` も安全である。** ANSI-C クォートの中では置換も展開も起きないので、`CLAUDE.md` の `--body=$'…'` はそのまま使う。長い本文はファイルにする。

### 引き金つき配送

`pnpm josh rule:guard` は、二重引用符の本文値にバッククォートか `$` を含む `Bash` 呼び出しを拒否する。拒否されたら本文をファイルに移して出し直す。**引き金が見えない綴り（`-b`・`-f title=` など）でも、フックが走らないエージェントでも規則は同じく拘束する。**
