# セッション向け出力で Issue はリンク＋セッション言語の短い要約で参照する

## セッション向け出力で Issue はリンク＋セッション言語の短い要約で参照する（joshuafolkken/kit#1758）

**規則**: セッション向け出力で Issue を指すときは、次の 2 つを必ず添える（対応前の「これから走らせる」「待機中」「対象外」の言及も含む）。

1. 番号にチケットへの markdown リンク
2. セッション言語（`JOSH_SESSION_LANG`、既定 `ja`）の短い要約タイトル（全訳でなくてよい）

- `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <その Issue が何をするものかの短い要約>`

**この引用行は `pnpm josh issue:cite <N> [<N> ...]` が出す。** 複数 Issue は 1 呼び出しにまとめ、他リポジトリは `--repo <owner/repo>` か `owner/repo#N` 表記（詳細は [docs/josh-commands.md](https://github.com/joshuafolkken/kit/blob/main/docs/josh-commands.md) の `josh issue:cite`）。タイトルは必要ならセッション言語に言い換える。素の `#N` の行（コミットメッセージ・PR 本文・イベント行・Telegram 本文）を写すときは引用形に直す。

### 適用範囲

**対象** — セッション向け出力。会話の説明、計画の提示、進捗報告、完了報告、`AskUserQuestion` の選択肢。

**対象外** — Issue 本文、Issue / PR コメント。

### 英語固定の 3 つとは衝突しない

要約はタイトルではなくセッション内の散文なので、`overview.md` →「出力の言語（`JOSH_SESSION_LANG`）」の英語固定とは矛盾しない。
