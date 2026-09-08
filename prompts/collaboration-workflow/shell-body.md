## 本文をシェルの二重引用符に載せない（joshuafolkken/kit#1198）

`CLAUDE.md` →「Never put a body in shell double quotes」の単一ソース。隣にある「Never carry a file's new text inside a shell command」（[`file-edits.md`](./file-edits.md)）と対になる規則である。**あちらは「ファイルの中身をシェルに載せるな」、こちらは「本文をシェルに載せるな」** であり、禁じている理由が違う — あちらはコストの二重払い、こちらは**テキストが実行されること**である。

### 何が起きるのか

シェルの二重引用符の中では、バッククォートはコマンド置換として、`$` は変数展開として**コマンドが走る前に評価される**。したがって次の呼び出しは、本文を投稿しない。

```bash
gh api repos/{owner}/{repo}/issues/1535/comments -f body="… `pnpm josh ms` は …"
```

zsh は `pnpm josh ms` を実行し、その標準出力を本文に埋め込む。2026-09-07 深夜の joshuafolkken/kit#1535 の実行では、これで**レーンの work tree が `main` に切り替わり、実行が止まった**。復旧は手動である。

同じ根がもう 1 つの口にもある。`pnpm josh followup --notify-message "…"` に渡した本文のバッククォート語（`` `owner/repo#` ``）が空文字に置換され、Telegram 通知の 1 行目から語が丸ごと消えた（joshuafolkken/kit#1176 の子 #1182）。**被害の重さが違うだけで、原因は同一である。**

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

joshuafolkken/kit#1198 のコメントは `!` も発火すると書いていたが、**この環境では発火しない**。引き金にも入れていない — 「!」を含む本文は日常的であり、そこで拒否するフックは[「誤ったターンで発火するフック」](./rule-delivery.md)そのものになる。

### 安全な書き方

**本文をファイルに書いて、パスで渡す。** シェルは本文を一切解釈しない。

```bash
gh api repos/{owner}/{repo}/issues/<N>/comments --field body=@<path>
gh api -X PATCH repos/{owner}/{repo}/issues/<N> --field body=@<path>
pnpm josh followup "<title> #<N>" --notify-message-file <path>
pnpm josh notify --task-type confirmation --issue-url "<url>" --body-file <path>
```

**PR コメントも同じ経路である** — REST では pull request のコメントは issue のコメントであり、上の 1 行目がそのまま使える。`gh issue comment` / `gh pr comment` にも `--body-file` はあるが、本リポジトリの配布ドキュメントは GraphQL 経由の `gh` サブコマンドを実行可能ブロックに書かない（クラウドセッションでは 403 になる。`scripts/gh-document-guard.test.ts`）。

`--body-file` / `--notify-message-file` はいずれも `-` で標準入力を読む（`gh issue create --body-file -` と同じ約束）。読み取りは `scripts/josh/cli-body.ts` の 1 本だけで、`josh notify` / `josh followup` / `epic --rationale-file` / `epic --decision-file` の 4 つがそれを共有する。**`--body` と `--body-file` の同時指定は拒否する** — 優先順位を決めると、ファイルを渡したつもりの呼び出しが、避けようとしていたインライン文字列をそのまま送ってしまう。

**`$'…'` も安全である。** ANSI-C クォートの中ではコマンド置換も変数展開も起きない。`CLAUDE.md` が Telegram の本文に `--body=$'…'` を指定しているのはそのためであり、この規則はそれを置き換えるものではない。ただし本文が長くなるほどファイルの方が扱いやすい。

### 引き金つき配送 — 書いただけでは守られないため

**規則を書くだけでは守られないことは、本リポジトリで繰り返し計測されている**（[`rule-delivery.md`](./rule-delivery.md)）。したがってこの規則は joshuafolkken/kit#1524 の機構に 1 行として載っており、`pnpm josh rule:guard` が該当する `Bash` 呼び出しを拒否して本文を突きつける。列挙表の行は `scripts/rules/delivered-rules.ts` の `shell-body` であり、その行が読む引き金 — どの綴りが本文をインラインで運ぶか、シェルがその値に何をするか — は `scripts/rules/shell-body-trigger.ts` にある。

**引き金はフラグではなく本文の中身である。** 本リポジトリのプロンプトにある作例はいずれもプレースホルダ（`-f body="<plan>"`）を渡しており、これは無害である。フラグで引くと、規則が既に守られているそれらのターンでも拒否することになる。実際にバッククォートか `$` を含む本文が二重引用符に載った瞬間だけが、テキストが実行される呼び出しである。

### 引き金が見えないもの

- **node の中から REST で投稿する経路**（`pnpm josh propagate` など）はシェル文字列に現れない
- **`gh api --input <file>`** は本文がファイルにあるため、そもそも安全である
- **`-b`（GitHub CLI の `--body` の短縮形）は覆っていない** — 同じ綴りが `git checkout -b` のブランチ名でもあり、そこで拒否するのは誤ったターンでの発火になる
- **`-f title="…"`** は覆っていない。タイトルは英語へ正規化された短い語であり、バッククォートを含む運用がない

**この 4 つがあるため、常駐側の 1 行は消していない。** 配送は Claude Code にしか届かず（Codex / Gemini / Cursor はフックを走らせない）、正規表現が知っている綴りだけが規則の適用範囲になってはならない。

### マーカーテスト

- `scripts/josh/cli-body.test.ts` — バッククォート・`$` を含む本文がファイル経由で無改変に通ること、`-` が標準入力を読むこと、通常ファイル以外の読める経路（`/dev/stdin`・プロセス置換）を開けること、インラインとファイルの同時指定を拒否すること
- `scripts/rules/shell-body-trigger.test.ts` — 危険な綴りで発火し、プレースホルダ・`@file` 形式・エスケープ済み `\$` では無言であること。`body=` のどちら側に引用符があっても発火すること、`$( … )` で包んでもバッククォートは免除されないこと、`$( … )` の中の引用符で捕捉が切れないことを、いずれも発火・非発火の対で固定する
- `scripts/rules/delivered-rules.test.ts` — 上の引き金が列挙表の行に配線されており、非 `Bash` ツールでは無言であること
- `scripts/shell-body-rule.test.ts` — 常駐 1 行がこの文書を指しており、配送文が被害・安全な綴り・再発行の指示を運ぶこと。**この一覧そのものも固定する** — 一覧が「あるスイートが何を固定しているか」を書きながら、そのケースが存在しないという食い違いが実際に起きた（`-` の標準入力）
