# セッション向け出力で Issue はリンク＋セッション言語の短い要約で参照する

## セッション向け出力で Issue はリンク＋セッション言語の短い要約で参照する（joshuafolkken/kit#1758）

番号だけの言及では、読み手は番号を内容に解決するために毎回 GitHub を開くことになる（`docs/maintainers/issue-citation-rationale.md` → "Why the rule exists"）。発火点が `CLAUDE.md` に常駐している理由は `docs/maintainers/issue-citation-rationale.md` → "Why the trigger is resident in CLAUDE.md" にある。

**規則**: セッション向け出力で Issue を指すときは、次の 2 つを必ず添える。

1. 番号にチケットへの markdown リンク
2. セッション言語（`JOSH_SESSION_LANG`、既定 `ja`）の短い要約タイトル

書き方の例:

- `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <その Issue が何をするものかの短い要約>`

**この引用行は手で組み立てるものではなく、`pnpm josh issue:cite <N> [<N> ...]` が出す。** 番号を並べて渡すと、貼れる引用行を 1 呼び出しでまとめて出す（複数 Issue に 1 回、他リポジトリは `--repo <owner/repo>` あるいは `owner/repo#N` 表記。`docs/maintainers/issue-citation-rationale.md` → "Why issue:cite prints the line"）。要約はその Issue のタイトルをそのまま用いる。詳細は [docs/josh-commands.md](https://github.com/joshuafolkken/kit/blob/main/docs/josh-commands.md) の `josh issue:cite` を参照。josh がセッション向けに出す警告・進捗行・要約行の Issue 番号は、はじめからリンク形で出るので、転記するときに組み直さなくてよい。コミットメッセージ・PR 本文・イベント行・Telegram 本文など GitHub やプログラムが読むために素の `#N` のまま出る行を写すときは、引用形に直す（`docs/maintainers/issue-citation-rationale.md` → "Why josh prints the citation form itself"）。

**要約タイトルは全訳ではなく要約でよい。** 何をするものか分かれば足りる。長い訳を作ることが目的ではない。`issue:cite` が出すタイトルを、必要ならセッション言語に言い換えて使う。

**対応前の言及も対象である。** 「これから走らせる」「待機中」「対象外」を並べる場面も含む。

### 適用範囲

**対象** — セッション向け出力。会話の説明、計画の提示、進捗報告、完了報告、`AskUserQuestion` の選択肢。

**対象外** — GitHub 上の artifact prose（Issue 本文、Issue / PR コメント）。GitHub は issue 参照を自動でリンクし、ホバーでタイトルを出すため、この規則が解決しようとしている問題がそもそも起きない。

### 英語固定の 3 つとは衝突しない

英語のままにするものは従来どおり 3 つ（`overview.md` →「出力の言語（`JOSH_SESSION_LANG`）」）。番号に添えるセッション言語の要約は GitHub 上の**タイトル**ではなく、セッション内の散文の一部なので、タイトルの英語固定とは矛盾しない。

### 停止時の担保（joshuafolkken/kit#2247）

`Stop` フック `pnpm josh stop:guard` が返信の地の文に裸の `#N` を見つけると**停止をブロックし**、その番号と `pnpm josh issue:cite <N...>` の実行形を差し戻す。差し戻されたら、その実行形で引用し直す（仕組みは `docs/maintainers/issue-citation-rationale.md` → "How the Stop hook delivers it"）。検出が外す範囲は [docs/josh-commands.md](https://github.com/joshuafolkken/kit/blob/main/docs/josh-commands.md) の `josh stop:guard` を参照。
