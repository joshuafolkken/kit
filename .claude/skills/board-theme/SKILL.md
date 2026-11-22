---
name: board-theme
description: Build a new `run:board` theme, or add or change a theme's effect, from a JS demo the user watches and picks. Read it when asked for the next board theme or a theme effect.
---

# Build a run:board theme from a demo

Kit-only: the themes live in `scripts/run/board/run-board-theme-defs.ts`, so `package.json` `files`
keeps this skill out of the package.

## 1. Pick the subject

- Candidates: #8384.
- Echo the work through color and motion only. Put no logo or sound of the work, and no asset file, in
  the repository — the matrix typing sound was synthesized from measurements of the original (#8365).

## 2. Measure the original

- Reproduce first, then add one touch (`principles.md` → "reproduce-first").
- Write down colors (hex), characters, speeds (ms) and the order of motion: step frame by frame
  through video or frames the user supplies, pick the colors, count the time between frames. Keep only
  the numbers; the source stays out of the repository.

## 3. Build the demo

- Copy the code block of [`demo-template.md`](demo-template.md) to
  `.josh/tmp/scratch/<theme>-theme-demo.mjs` and write the effects there in JS — a moving effect is
  easier to decide on than a described one.
- A consultation session runs it only through `pnpm josh scratch:run <path>`.
- Build the mock board from a real frame: `NO_COLOR=1 pnpm josh run:board --once --theme <theme>`.
  Keep the board's paces (a letter every 50 ms, a spinner frame every 80 ms) — the closer the mock, the
  less drift later.
- Sound: synthesize a WAV and play it from an HTML page the user opens in a browser — `scratch:run`
  cannot start a child process, so it cannot call `afplay`.

## 4. Show it

- Write the run command in every reply. One variant per argument; no argument tours them all. The
  caption at the bottom names the variant playing — the user compared more than ten variants.
- You cannot see the screen: write "behavior checked, look unchecked".
- One change per reply. Show in two stages: first the demo that matches the original item by item,
  beside the measured numbers; after the user passes it, three variants that each add a touch. A
  rejected variant may stay in the demo; note its name.

## 5. File the Issue once the user decides

- Only after the user says to file it (`kickoff new`). The brief carries the decided numbers, the
  rejected variants, the demo's shortcuts and the existing behavior that must not change. List the
  items kept as in the original apart from the items changed on purpose.
- **Put the demo's code in the Issue body when filing**, never in a later comment — #8354 started
  implementing before a code comment was read. Write: colors, characters, speeds and odds follow the
  code; what the demo lacks (disable conditions, simultaneous typing, existing behavior, render cost)
  follows the body.
- The body names the functions to read, the rejected variants (not implemented), the demo's shortcuts
  (the real behavior wins), and which element takes which color (rules, text inside the rules,
  the waiting mark, gauges) — numbers without the assignment caused #8354's two misses (#8390).
- **Write in the body and the acceptance criteria that the new effect leaves the existing themes'
  look unchanged** — the user warned about the wargames lamp panel (#8376).

## 6. After the first merge

- **Compare the implementation's commit with the demo's code**, comment the matches and the
  differences on the Issue, and file each difference as a fix Issue — #8354's comparison caught three
  (#8390, #8391).

## Examples

- matrix: epic #8357; the demo code is in the comments of its children #8352–#8370.
- wargames typing effect: epic #8377 (#8375, #8376); demo code:
  https://github.com/joshuafolkken/kit/issues/8376#issuecomment-7039783569
- A demo-versus-implementation comparison:
  https://github.com/joshuafolkken/kit/issues/8354#issuecomment-7039850496
- Next theme candidates: #8384.
