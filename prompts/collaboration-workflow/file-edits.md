## ファイル編集はコマンド本文に本文を載せない

`CLAUDE.md` からは [`rule-delivery.md`](./rule-delivery.md) →「配送されている規則」を経て届く。

`pnpm josh rule:guard`（file-body の行）が、既存ファイルを書き戻すヒアドキュメント・書き込むインタプリタ heredoc / `node -e`・書き込むスクリプトを作るヒアドキュメント・`perl -0pi -e` を拒否する。ガードに見えない Edit / Write の全文書き直しと `sed -i` は以下に従う。

### 何を禁じているか

**編集後のテキストを丸ごとコマンド行に載せる形を禁じる。** 典型（`NEW_REGION` には置換後の本文が載る）:

```bash
python3 - <<'PY'          # ← 禁止
text = open('CLAUDE.md').read()
open('CLAUDE.md', 'w').write(text.replace(OLD_REGION, NEW_REGION))
PY
```

領域を書き換える編集は Edit ツール（old / new の差分）で行う。`node -e`、`cat > file <<'EOF'`、`tee file <<'EOF'`、`perl -0pi -e` に長い置換文字列を渡す形も禁止。

### 判断基準は「本文を丸ごと運ぶか」であり、ツール名ではない

> **そのコマンドは、置換後のテキストを丸ごとコマンド本文に載せているか。**

- yes → 禁止。Edit を使う
- no → 許可（短い置換の `sed -i` は下の 4 条件つきで可）

### 編集は指摘された箇所だけを対象にする（全文書き直しの条件）

**既定は部分編集である。** `old_string` / `new_string` は直す行の周辺までに狭める — Edit / Write の全文書き直しは禁じている形と同じコストを払う。全文を書いてよいのは次の 3 つだけ:

- 新規ファイルの作成
- ファイル全体の作り直し — 変更後の本文が元とほとんど共有しない場合
- 部分編集のほうが大きくなる場合 — `old_string` / `new_string` の合計が全文を超えるとき（このときも Write で書く）

実測は `docs/maintainers/file-edits-rationale.md` → "Measured cost of whole-file rewrites"（joshuafolkken/kit#1260）。

### `sed -i` を使う前に満たす 4 条件

`sed` は一致した全行を書き換え、一致 0 件でも黙って成功する。使う前に次を満たす。

1. **出現回数を先に数える** — `grep -o '<pattern>' <file> | wc -l` が `1` であること。`grep -c` は行数を数えるので使わない
2. **メタ文字を持ち込まない — パターン側と置換語側の両方** — `/`、`&`、`\`、`.` `*` `[` `]` `^` `$` のいずれかが入るなら Edit を使う
3. **`-i` の引数はプラットフォームで違う** — BSD / macOS は `sed -i '' 's/…/…/' file`、GNU / Linux は `sed -i 's/…/…/' file`。配布ドキュメントに書くときはこの差を明示する
4. **編集後に自分で整形する** — Bash 経由の編集では `PostToolUse` の整形が走らない（joshuafolkken/kit#1337）ので `pnpm josh format` を走らせる（`format:edited` は手で呼べない）

**4 条件のどれかが面倒に見えたら、そこが Edit を使う場所である。**

| 形                                               | 可否                |
| ------------------------------------------------ | ------------------- |
| Edit（数行の old / new）                         | 可                  |
| `sed -i` の短い置換                              | 上の 4 条件つきで可 |
| `python3 - <<'PY'` で書き戻す                    | 不可                |
| `cat > file <<'EOF'`（既存ファイル）             | 不可                |
| `cat > new-file <<'EOF'`（新規、長文なら Write） | 可                  |
| `cat > edit.py <<'EOF'`（書き込むスクリプト）    | 不可                |
| 読み取り（`cat` / `sed -n` / `grep`）            | 可                  |

### なぜコストが二重になるか

書き戻す形は本文がコマンドとファイルの両方に載り、コマンドは以降の全リクエストで読み直される。内訳は `docs/maintainers/file-edits-rationale.md` → "Measured breakdown of command text"、常駐の根拠は `docs/maintainers/file-edits-rationale.md` → "Why it is resident"、固定内容は `docs/maintainers/file-edits-rationale.md` → "Marker tests"。
