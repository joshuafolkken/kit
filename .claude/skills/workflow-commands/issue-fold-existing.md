# 未着手 Issue への追加要件の統合

## 候補の読み取り

起票予定の目的・要件・受け入れ条件を含む全文を `pnpm josh issue:scout "<title>" --body-file <draft.md>` に渡す。明示的に参照した `#N` は見出しが似ていなくても候補になる。`Duplicates: incomplete` は読み取りまたは探索の不足であり、候補なしという結論ではない。

候補の本文とコメントを `pnpm josh issue:read <N>` で全て読み、状態とラベルを `pnpm josh issue:state <N>` で読む。紐づく PR と依存・実行順も調べる。本文と後のコメントが矛盾した場合は後のコメントを採る。読み取り失敗や打ち切りがあれば統合可否は未確定とする。

## 判定

下書きの各受け入れ条件を既存 Issue と照合する。完全な重複は起票も編集もしない。別の成果物は従来の起票経路を使う。固有の追加要件を統合できるのは、既存 Issue が open かつ未着手で PR がなく、依存と実行順に衝突がなく、合計の規模が `split-assessment.md` → "The question" の一回の検証に収まる場合に限る。状態または判断材料が不明なら統合しない。

判定記録の JSON を作り、`pnpm josh issue:fold-existing <assessment.json> --json` を実行する。`content` は `duplicate` / `compatible` / `separate` / `unknown`、`size_verdict` は `single` / `split` とする。ほかに `is_open`、`is_unstarted`、`has_pull_request`、`has_complete_read`、`has_dependency_conflict`、`is_separable`、`existing_body`、`draft_body`、`verification` を記録する。不明な事実は省略し、`inspect` を得る。判定記録は読んだ証跡であり、読み取りそのものの代わりにはならない。

## 追記と再読

`fold` の場合、追記案の `body` は元の本文を保持し、固有の追加要件と検証方法を末尾に加える。書き込み直前に本文とコメントが判定時から変わっていないことを再確認する。変わっていれば再判定する。

```bash
pnpm josh issue:fold-existing assessment.json --json > result.json
jq -e '.verdict == "fold"' result.json
jq '{body: .body}' result.json > patch.json
gh api -X PATCH repos/{owner}/{repo}/issues/<N> --input patch.json
pnpm josh issue:read <N>
```

再読して、元の要件・コメント中の判断記録・追加要件・検証方法が残ることを確認する。書き込みまたは再読が失敗した場合、統合は完了していない。統合時は新しい Issue を作らない。`separate` は従来の起票経路へ戻り、`inspect` は不足した情報を読み直す。
