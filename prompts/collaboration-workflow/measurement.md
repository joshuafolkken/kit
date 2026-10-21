# 所要時間は記録から測る

**CI と gate の所要時間は記録から読む。計測のために全ツリーのツールを手元で再実行しない。**

再実行はコア予算の外で走り、並走する lane と重なる。`timed-rerun` 行（`rule-delivery.md`）が配送する。

## 記録の読み方

- CI のジョブとステップ: Actions の記録を読む。

  ```bash
  gh api --method GET "repos/<owner>/<repo>/actions/runs?branch=<branch>&per_page=5" --jq '.workflow_runs[] | [.id, .name, .conclusion, .run_started_at, .updated_at] | @tsv'
  gh api --method GET "repos/<owner>/<repo>/actions/runs/<run_id>/jobs?per_page=100" --jq '.jobs[] | [.name, .started_at, .completed_at] | @tsv'
  gh api --method GET "repos/<owner>/<repo>/actions/runs/<run_id>/jobs?per_page=100" --jq '.jobs[] | select(.name == "<job>") | .steps[] | [.name, .started_at, .completed_at] | @tsv'
  ```

- 手元の gate とチェックごとの所要時間: `pnpm josh lane:stats --period <days>`（gate の記録、`docs/josh-commands-run.md`）。

## 手元で再実行してよいとき

記録で答えられない問い（記録の無い変更前後の比較など）に限る。

- 1 回だけ実行する。lane 子は `pnpm josh reserved-run <weight> -- <command>` で包み、コア予算に数えさせる。
- 結果を Issue のコメントに残し、以後はそれを使い回す。
