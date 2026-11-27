---
name: board-theme
description: Show a `run:board` look change on the live board's demo mode or as a printf; build themes and effects directly in kit from the original measured on video. Read it unasked before proposing or filing a theme or board look change — not a fix restoring the look.
---

# Show and build run:board looks

Kit-only. A theme is a row in `scripts/run/board/run-board-theme-defs.ts` (`THEME_DEFS`: board name,
opening line, typing voice, typed end, sound score) and a module the theme host draws
(`run-board-theme-registry.ts`, `run-board-theme-<value>-*.ts`).

| Read | When |
|---|---|
| [What a theme carries](theme-rules.md) | Deciding a theme's items, events, places, timing, names |
| [Sound](theme-sound.md) | Deciding and building its sounds |
| [From video](theme-video.md) | Finding and measuring the original's look and sound |
| [Wiring](theme-wiring.md) | Placing the look by kit's layout and checking it |
| [Split](theme-split.md), [render cost](render-cost.md) | Filing |

The order: the theme is built directly in kit → the live board's demo mode shows it (`/`, the theme's
key, `s` `a` `d` `w` `q` `e`) → bases of the real board's shape check it. No throwaway JS demo.

## 0. Show the change

- Before proposing or filing a look change, unasked:
  - It moves → the live board's demo mode, in the work tree that holds the change (step 4).
  - It does not move → a `printf` command in the reply that prints the frame before and after the
    change, for the user to paste into a terminal — you cannot see the screen.
- Base the `printf` on a real colored frame, taken afresh for each proposal, never a hand-drawn board:
  `FORCE_COLOR=3 pnpm josh run:board --once --theme <theme> > .josh/tmp/scratch/<theme>-frame.ans`.
- Skip it for a fix that only restores the existing look.

## 1. Pick the subject

- Candidates: #8384.
- Decide every item of [what a theme carries](theme-rules.md) → "Checklist" before asking for approval.
- Names of the work may be written as text on the board (the user's decision, 2026-11-27). No asset
  file and no recorded sound of the work in the repository (#8365, [sound](theme-sound.md)).
- A logo: an exact copy of the work's logo in the repository is the user's call per theme — ask. A
  plain mark drawn in characters needs no asking.

## 2. Measure the original

- Reproduce first, then add one touch (`principles.md` → "reproduce-first").
- Find and read the original yourself from video: [from video](theme-video.md). Do not ask the user
  for timestamps or screenshots.
- Write down colors (hex), characters, speeds and the order of motion. Keep only the numbers.
- What you could not confirm on a frame is written "unconfirmed", never filled from memory.
- Copy the text, order, colors and layout an image shows as they are. Report what you filled in from
  memory or invention.
- A terminal draws no true curve: line characters are smooth but thin, blocks bold but square — let
  the user compare both.

## 3. Build it in kit

- A no-filing request → the `producer`: one work tree for the whole theme; fixes go to the same unit.
  Give every change in one brief — a unit resumed many times can lose its authority.
- An Issue → the usual lanes.
- Decide yourself how what you found maps to IDLE / PROGRESS / ROW / NOTICE / OPENING / ENDING and
  the ground look, and build. The user reviews the result, not a menu of options.
- Keep the board's paces (a letter every 50 ms, a spinner frame every 80 ms).
- Place every part by kit's layout and check it on real bases: [wiring](theme-wiring.md).
- Sound: decide it by waveform values ([sound](theme-sound.md)).

## 4. Show it

- Every reply: the one view command alone in its code block, no trailing comment —
  `cd <work tree> && pnpm josh run:board --theme <value>`; then `/`, the theme's key and
  `s` `a` `d` `w` `q` `e`.
- Write "behavior checked, look unchecked"; for sounds, "unchecked by ear". You see neither color nor
  motion: check places on a text capture and say which parts you checked.
- Take fixes as "the theme's key and the event's key". When an instruction reads two ways, say how
  you read it and go on.
- Report every departure from the original or the brief, and every invented word or value. Report
  additions nobody asked for apart and ask whether to keep them.
- Before a change the user "may revert", keep a copy of the current version under another name.

## 5. File the Issue once the user decides

- Only after the user says to file it (`kickoff new`). The brief carries the decided numbers and the
  existing behavior that must not change, and lists the items kept as in the original apart from the
  items changed on purpose.
- **The Issue body names the work tree or commit that holds the look**, never a later comment — #8354
  started implementing before a comment was read. Write: colors, characters, speeds and odds follow
  that code; what it lacks (disable conditions, simultaneous typing, existing behavior) follows the
  body.
- Write the render-cost conditions in the body and the acceptance criteria — a light look on one
  base proves nothing: [render cost](render-cost.md) → "When filing".
- The body names the functions to read, the rejected variants (not implemented), the built look's
  shortcuts (the real behavior wins), and which element takes which color (rules, text inside the
  rules, the waiting mark, gauges) — numbers without the assignment caused #8354's two misses (#8390).
- **Write in the body and the acceptance criteria that the new effect leaves the existing themes'
  look unchanged** (#8376).
- A look approved or changed → record its golden replay in that PR: `docs/josh-commands-board.md` →
  "`josh board:compare`".
- Before a theme PR opens → `pnpm josh test:related scripts/run/board/run-board-motion-*x*.test.ts`
  passes (mandatory; the per-frame motion check over every theme, size and scene).
- Split into children: a seam child, then parallel effect children ([split](theme-split.md)); each
  takes the look's drawing in unchanged and places it by kit's layout ([wiring](theme-wiring.md)).

## 6. After the first merge

- **Compare the implementation's commit with the work tree or commit the Issue named**, comment the
  matches and the differences on the Issue, and file each difference as a fix Issue — #8354's
  comparison caught three (#8390, #8391).
- Comment the real board's `--timing` values on the Issue once every effect child has merged:
  [render cost](render-cost.md) → "After every effect child has merged".

## Working rules

- Gather the points the user finds by eye and hand them over as one piece of work, in one brief that
  holds everything. Record on the Issue only the decisions that stay as the spec.
- Keep investigation and implementation in separate pieces of work; finish the implementation first.
- Never let two pieces of work touch the same file at once; files apart may go in parallel. The agent
  that built a theme also takes its fixes.
- While the look is being tuned, tests and the gate wait for the finish:
  `prompts/collaboration-workflow/principles.md` → "consult-vs-execute".
- Two defects of one shape → stop fixing one at a time; find that shape in every theme's code.
- Read a request no wider than it is: fixing a value shown as `--` changes no effect.

## Examples

Built from a JS demo, before themes were built in kit directly:

- trace: epic #8357; demo code in its children's comments, #8352–#8370.
- wopr typing effect: epic #8377 (#8375, #8376); demo code:
  https://github.com/joshuafolkken/kit/issues/8376#issuecomment-7039783569
- Demo-vs-implementation comparison:
  https://github.com/joshuafolkken/kit/issues/8354#issuecomment-7039850496
