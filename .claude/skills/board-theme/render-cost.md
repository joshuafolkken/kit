# Carry the render cost from the demo into the theme

Read from `SKILL.md` → "5. File the Issue once the user decides" and "6. After the first merge". A
light demo is no evidence: it plays on one still frame in its own loop, while the real board redraws
every second, runs every effect at once, reads the workers and prepares the sound on the same thread.
Write no limit here; the limits are the budget test's and the baseline's.

## When filing

- Write both in the body and the acceptance criteria of every theme and effect Issue:
  - the all-layers budget test of #8825, `scripts/run/board/run-board-composite-budget.test.ts`,
    stays green;
  - wargames, matrix and bttf, each run on the real board with its opening by
    `pnpm josh run:board --timing --theme <theme>`, stall and wake lag no worse than the
    `--timing` baseline recorded on #8904.

## Seam and effect children

- The seam child adds the new theme to the budget test, its effects drawing nothing.
- Each effect child keeps the budget test green with its effect drawing.

## After every effect child has merged

- Run the three themes as above and comment on the Issue: the stalls (count, length, `at` and
  stage), the wake lag (max, median, late wakes) and the `redraw` breakdown outside the draws.
- Worse than the #8904 baseline → file a fix Issue.
