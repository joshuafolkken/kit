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

## 効果を測る後続 Issue

PR の効果を測る後続 Issue を起票するとき:

- 開始条件は日数でなく標本数で書く: `## 背景` に `- 実施可能条件: #<PR> のマージ後 <K> マージ`（`issue-template.md`）。`#<PR>` は元の PR の番号で、Issue の番号は `issue:file` が refuse する。`- 計測宣言:` のある Issue と、見積もりが 0 ファイルで受け入れ条件が `#<N>` の変更について記録（`lane:stats`・`actions/runs`）を読む Issue に条件が無いときも、`issue:file` が refuse する。
- K は測る値の種類で決める:
  - 事象の回数の率（停止・再利用など）: 変更前の率で 10 件以上見込める最小のマージ数（K ≥ 10 ÷ 変更前の率）。変更前の標本数を上限の目安にする。
  - 連続値の平均・差（所要時間など）: 5〜10。
  - 最大値・裾: 変更前の標本数と同程度。
- 受け入れ条件の集計は固定日数でなく `pnpm josh lane:stats --period <days>` とし、`<days>` は元 PR のマージからの経過日数（小数可）にする。

計測を記録し終えた → `pnpm josh issue:measured <N> --evidence-file <path>`。`.claude/skills/workflow-commands/issue-comments.md` →「A measurement-only Issue」。

## 手元で再実行してよいとき

記録で答えられない問い（記録の無い変更前後の比較など）に限る。

- 1 回だけ実行する。lane 子は `pnpm josh reserved-run <weight> -- <command>` で包み、コア予算に数えさせる。ESLint は `--concurrency off` で走らせ、並列度の計測はレーン外で行う（`lane-direct-tool`）。
- 結果を Issue のコメントに残し、以後はそれを使い回す。
