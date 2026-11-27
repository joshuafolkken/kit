# Carry the render cost into the theme

Read from `SKILL.md` → "5. File the Issue once the user decides" and "6. After the first merge",
and from [split](theme-split.md).

- One effect played light in demo mode is no evidence: the real board redraws every second, runs
  every effect at once, reads the workers and prepares the sound on the same thread.
- Write no limit here; the limits are the budget test's and the baseline's.

## When filing

- Write both in the body and the acceptance criteria of every theme and effect Issue:
  - the all-layers budget test of #8825, `scripts/run/board/run-board-composite-budget.test.ts`,
    stays green;
  - every theme (`wopr`, `trace`, `flux`, `codec`, `nixie`, `skynet`, `magi`, `deviant`, `isac`,
    `ghost`), each run on the real
    board with its opening by
    `pnpm josh run:board --timing --theme <theme>`, stall and wake lag no worse than the
    `--timing` baseline recorded on #8904.

## Seam and effect children

- The seam child adds the new theme to the budget test, its effects drawing nothing.
- Each effect child keeps the budget test green with its effect drawing.

## After every effect child has merged

- Run every theme as above and comment on the Issue: the stalls (count, length, `at` and
  stage), the wake lag (max, median, late wakes) and the `redraw` breakdown outside the draws.
- Worse than the #8904 baseline → file a fix Issue.

## Frame weight

- Keep the effect; make it lighter without changing its look. Shrinking the drawn area is the last
  resort.
- The weight comes from effects that change every cell's background each frame. Lighten in order:
  write changed cells only, write only the background of a cell whose background alone changed, round
  backgrounds to steps of six, write a frame as one synchronized-output block.
- Keep a row's background one color where possible: a band moving over a flat color changes only at
  its edges, a smooth gradient changes everywhere.
- Aim a NOTICE frame's average write under 60 kB; measure the whole NOTICE.
- Bytes are not the terminal's drawing speed: smoothness by eye decides last.
