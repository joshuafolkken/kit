# Approve a lane plan past its size guide

## When to use it

A lane child's [`josh lane:plan`](../josh-commands-lane.md#josh-laneplan) answered `split` on the lines or files axis, and a person has approved, in a comment on that same Issue, letting this one Issue run larger. The approval is bounded: you, the operator, read the comment and write its scope into a JSON file. Nothing infers an approval from prose.

## Steps

1. Open the approving comment and copy its URL (`…/issues/<N>#issuecomment-<id>`). It must be a trusted comment on the Issue the lane runs — `lane:plan` matches the URL against that Issue's trusted comments.
2. Write the scope under `.josh/tmp/`, e.g. `.josh/tmp/size-approval-6594.json` for kit's Issue 6594, which declared 170 lines and was approved up to 204 (170 × 1.2):

   ```json
   {
   	"issue": 6594,
   	"paths": [
   		"scripts/lane/lane-size-stats.ts",
   		"scripts/split/split-assess.ts",
   		"scripts/issue/size-estimate.ts"
   	],
   	"declared_lines": 170,
   	"max_lines": 204,
   	"source": "https://github.com/joshuafolkken/kit/issues/6594#issuecomment-6687208090",
   	"rationale": "Approved 170 lines × 1.2 = 204 for this Issue; quality gates stay."
   }
   ```

   - `issue`, `paths`: the Issue and every file the plan may hold.
   - `declared_lines` / `max_lines`: the Issue's `- 規模見積もり:` lines and the predicted ceiling the comment approves. Use `declared_files` / `max_files` for the files axis, or both pairs.
   - `source`, `rationale`: the comment URL and the reason, recorded as evidence.

3. Check it without recording: `pnpm josh lane:plan 6594 <path>... --size-approval .josh/tmp/size-approval-6594.json --probe`.
4. Record the plan with the same command without `--probe`. `--size-approval` goes before `--imports`.

## Check it worked

- `lane:plan` prints `clear`, and the recorded plan holds the approval with the comment's author and body.

## What the approval does not change

- It applies only while every planned path is in `paths`, the Issue's declaration equals `declared_lines` / `declared_files`, and the predicted size stays within `max_lines` / `max_files`. A re-plan reuses the recorded approval under the same checks.
- The hunk check, the clash and yield between lanes, `josh gate` and the pre-commit review still apply.

## Common failures

- Usage printed, exit 1: the file does not parse, its `issue` differs from the lane's, or `source` matches no trusted comment on that Issue.
- Still `split`: a planned file is missing from `paths`, the declaration changed, the prediction is over the ceiling, or the axis is hunks, which no approval covers.
