## 実機証跡

`pnpm josh issue:file --help` の usage から `--depth` が消えている:

```
Usage: josh issue:file "<title>" --body-file <path> [--route <tier-a|split|interrupt|review-cap>] [--label <name>]… [--repo <owner/repo>] [--distinct <N,…>] [--over-cap] [--no-auto-ok] [--release]
```

`pnpm josh test:related`（`scripts/test/pure-files.ts` 変更のため全ユニット）: 1576 files / 24338 tests passed。`pnpm josh lint:related` green。

## 受け入れ条件の対応

- `ac-be9ebc39` `issue:file` から `--depth` を外し、起票した Issue に `depth:*` が付かないことをテストで固定する — 満たした: `scripts/issue/issue-file.test.ts:85` "issue_file.parse — the retired depth label"（refuses the retired --depth / applies no depth label）
- `ac-c47fda2c` `issue:release` が `depth:0` を付けないことをテストで固定する — 満たした: `scripts/issue/issue-release-cli.test.ts:115` `labels: ['release']`
- `ac-f98691b7` `DEPTH_*` 定数・`DEPTH_LABELS`・`DEPTH_LABEL_ORDER`・`depth_label_of` を `issue-labels.ts` から消し、`REPOSITORY_LABELS` に `depth:*` が無いことをテストで固定する — 満たした: `scripts/issue/issue-labels.test.ts:160` "neither manages nor provisions the retired %s"
- `ac-9b3d0784` guard・フックの文言と `scripts/rules/issue-depth-label` から `--depth` / depth ラベルの前提を消す（`issue-depth-label` は不要なら削除） — 満たした: `scripts/rules/direct-filing.ts`・`stop-rules.ts` の文言から `--depth` を削除、`scripts/rules/issue-depth-label.test.ts` を削除（`scripts/test/pure-files.ts` からも除去）
- `ac-e37755cb` 上に挙げた文書から depth ラベルと `--depth` の記述を消す。"The depth test" の読み方自体は残す — 満たした: 列挙の文書から削除、`observation-filing.md` → "The depth test" は残存。`git grep -- '--depth'` は無関係の `backlogrun --depth` 以外 0 件
- `ac-dfdc8f02` `--depth` を含む呼び出しを廃止済みの言い回し（`scripts/document/retired-phrases.ts`）に登録し、文書に残っていれば落ちることをテストで固定する — 満たした: `scripts/document/retired-phrases.ts:27`、走査は `scripts/document/document-markers.test.ts:86` "retired phrases stay gone"
- `ac-2a19ab47` マージ後に、**open の Issue だけ**から `depth:0` / `depth:1` / `depth:2` を外す。closed の Issue と、リポジトリのラベル定義はそのまま残す — 見送り: #4118 ラベル削除（`gh api -X DELETE`）は Tier C でランから実行できないため、対象 13 件を列挙して人の作業として切り出した
