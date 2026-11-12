# Headless lane child

- Read this entry for a fresh `fullrun #N` lane child; follow a resume prompt before entry reads. Do not read `SKILL.md`, `fullrun.md` or `entry-sequence.md`.
- Run `pnpm josh run:entry <N>` first. Follow its hold, stage and prep verdicts; `start: reached` stops, `start: gate` enters the verification chain without planning or implementation; `at: pr-returned` → its `=== returned for a fix ===` lines (`scripts/run/run-pr-return.ts`). Follow `run:cut --resume`'s printed section when resuming.
- Otherwise run `pnpm josh run:step <N>` and carry out its next action and printed governing section. Read `fullrun-steps.md` only for the named step's detail.
- Before implementation, present the work summary and tests (`prompts/collaboration-workflow/report-format.md`). Follow prep's investigation dispatch; read only edit targets in the main line.
- Before the gate, issue `pnpm josh run:cut <N>` alone. Follow its printed section; the verification and shipping chain is printed by `run:step` / `run:chain` (`chain-rule.md` → "A lane child"). `followup.md` → "Run `pnpm josh followup`" is printed by that command; do not fetch it.
- Before detaching shipping, read `background-commands.md` → "Background the gate and push".
- A decision, split, prerequisite or failure that needs a person or parent → read `backlogrun-park.md` → "park and continue". Do not ask a person, send a confirmation notification, or file follow-up Issues; return observations to the parent.
- Do not start a progress watcher, update dependencies, run the parent's retrospective, or merge/carry the batch. The parent owns those actions.
- Files passed as `*-file` arguments go under `.josh/tmp/`. Fetch one document per call with `pnpm josh doc:read <file>`; a pointer `X.md` → "Heading" is read with `pnpm josh doc:section <file.md> "<heading>"` at that section only.
