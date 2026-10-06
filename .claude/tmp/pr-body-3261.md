closes #3261

## 概要

手書きの argv パーサが残っていた 6 か所（`epic` の各フォーム、`epic:next`、`issue:comment`、`issue:state`、`propagate`、`backlogrun` の再構築文法）を `lib/cli-flags.ts` 経由に置き換えた。どれも厳格な読み取りになり、未知のフラグは無視されずに拒否される。`--flag=value` のインライン表記もそろって読めるようになった。

挙動が変わる点（回帰テストを追加済み）:

- `josh epic` の作成・昇格フォーム: 未知のフラグ（`--after` の打ち間違い、途中で切れた `--order` など）を無視せず拒否する。`--rationale-file` を 2 回渡すと拒否する。
- `josh epic:next`: 未知のフラグを拒否する。フラグの後ろに置いたエピック番号も読む。
- `josh issue:comment`: 未知のフラグを拒否する。ダッシュで始まる本文は `--body=<text>` で渡す。
- `josh propagate`: `--target=<repo>` を読む。
- `backlogrun` の再構築: `--max=5` を `--max 5` として組み立て直す。`--` は拒否する。

## 実機証跡

厳格になった読み取りを実際のコマンドで動かした。未知・不完全なフラグはどれも usage を出して終了コード 1 で止まり、何も書き込まない。正しいインライン表記はそのまま通る。

- `pnpm josh epic:next 858 --repo joshuafolkken/kit --lane`

```
$ pnpm josh epic:next 858 --repo joshuafolkken/kit --lane
Usage: josh epic:next <epic-number|owner/repo#number>... [--repo <owner/repo>] [--lanes]
exit=1
```

```
$ pnpm josh issue:state 3261 --rep=joshuafolkken/kit
Usage: josh issue:state <issue-number> [<issue-number> ...] [--repo <owner/repo>]
exit=1
$ pnpm josh issue:state 3261 --repo=joshuafolkken/kit
state: OPEN
labels: enhancement, in-progress, route:split, auto-ok, depth:1, run:lane
human_review: no
exit=0
```

```
$ pnpm josh issue:comment 3261 --body note --bdy-file x
Usage: josh issue:comment <issue-number> --body <text> | --body-file <path>
exit=1
```

```
$ pnpm josh propagate --dryrun
Unknown argument(s) or a repeated --target: --dryrun
Usage: josh propagate [--skip-publish-wait] [--dry-run] [--target <repo>]
exit=1
$ pnpm josh propagate --target
--target needs a repository name, e.g. --target app-kit
exit=1
```

```
$ pnpm josh epic "Probe title" 101 102 --order
✖ A title and at least one child issue number are required.
Usage: josh epic "<title>" <N1> <N2> ... [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]
...
exit=1
```

```
$ pnpm josh test:related
 Test Files  191 passed (191)
      Tests  3686 passed (3686)
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
