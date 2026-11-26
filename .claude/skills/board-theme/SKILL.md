---
name: board-theme
description: Show a `run:board` look change as a JS demo or a printf; build themes and effects from a demo the user picks. Read it unasked before proposing or filing a theme or board look change — not a fix restoring the look.
---

# Show and build run:board looks

Kit-only. A theme is a row in `scripts/run/board/run-board-theme-defs.ts` (`THEME_DEFS`: board name,
opening line, typing voice, typed end, sound score) and a module the theme host draws
(`run-board-theme-registry.ts`, `run-board-theme-<value>-*.ts`).

| Read | When |
|---|---|
| [What a theme carries](theme-rules.md) | Deciding a theme's items, events, places, timing, names |
| [Sound](theme-sound.md) | Deciding and building its sounds |
| [Demo template](demo-template.md) | Building the demo and the states it must try |
| [Wiring](theme-wiring.md) | Moving a confirmed demo into kit and checking it |
| [Split](theme-split.md), [render cost](render-cost.md) | Filing |

The order: a throwaway JS demo confirms the look → its drawing moves into the theme's module unchanged
in shape → the live board's demo mode and bases of the real board's shape check it.

## 0. Show the change

- Before proposing or filing a look change, unasked:
  - It moves → a JS demo (step 3).
  - It does not move → a `printf` command in the reply that prints the frame before and after the
    change, for the user to paste into a terminal — you cannot see the screen.
- Base both on a real colored frame, taken afresh for each proposal, never a hand-drawn board:
  `FORCE_COLOR=3 pnpm josh run:board --once --theme <theme> > .josh/tmp/scratch/<theme>-frame.ans`.
- Skip it for a fix that only restores the existing look.

## 1. Pick the subject

- Candidates: #8384.
- Decide every item of [what a theme carries](theme-rules.md) → "Checklist" before asking for approval.
- Echo the work through color, motion and computed sound only; no logo, recorded sound or asset file
  of the work in the repository (#8365, [sound](theme-sound.md)).

## 2. Measure the original

- Reproduce first, then add one touch (`principles.md` → "reproduce-first").
- Write down colors (hex), characters, speeds and the order of motion, stepping frame by frame
  through video or frames the user supplies. Keep only the numbers.
- You cannot play video: ask the user for screenshots of the moments to match. Given only a time, say
  so, and answer what is known and unknown about that scene; add no guessed effect.
- Copy the text, order, colors and layout an image shows as they are. Report what you filled in from
  memory or invention.
- A terminal draws no true curve: line characters are smooth but thin, blocks bold but square — let
  the user compare both.

## 3. Build the demo

- Copy the code block of [`demo-template.md`](demo-template.md) to
  `.josh/tmp/scratch/<theme>-theme-demo.mjs`; write the effects in JS on the step 0 frame. Run it
  only through `pnpm josh scratch:run <path>`.
- A number key picks a scene from its start; it loops, two seconds of normal display between
  plays; the top two rows name the scene and list the keys; `Q` quits. Other axes: letter keys, a
  third row. `DEMO_STEPS=<n>` checks it headless.
- Keep the board's paces (a letter every 50 ms, a spinner frame every 80 ms).
- Follow [demo template](demo-template.md) → "Demo rules" and try its "States to try" at the demo stage.
- Sound: decide it by waveform values ([sound](theme-sound.md)); the demo plays none.

## 4. Show it

- Every reply: the one command, no argument, alone in its code block, no trailing comment.
- Write "behavior checked, look unchecked"; for sounds, "unchecked by ear". You see neither color nor
  motion: check places on a text capture and say which parts you checked.
- One change per reply, in two stages: the demo that matches the original item by item beside the
  measured numbers; once passed, three variant scenes each adding a touch. A rejected one may stay;
  note its name.
- Take fixes as "the theme's number and the event's key". When an instruction reads two ways, say how
  you read it and go on.
- Report every change that affects the look, asked for or not. Report additions nobody asked for
  apart and ask whether to keep them.
- Before a change the user "may revert", keep a copy of the current version under another name.

## 5. File the Issue once the user decides

- Only after the user says to file it (`kickoff new`). The brief carries the decided numbers and the
  existing behavior that must not change, and lists the items kept as in the original apart from the
  items changed on purpose.
- **Put the demo's code in the Issue body when filing**, never in a later comment — #8354 started
  implementing before a code comment was read. Write: colors, characters, speeds and odds follow the
  code; what the demo lacks (disable conditions, simultaneous typing, existing behavior) follows
  the body.
- Write the render-cost conditions in the body and the acceptance criteria — the demo's
  lightness proves nothing: [render cost](render-cost.md) → "When filing".
- The body names the functions to read, the rejected variants (not implemented), the demo's shortcuts
  (the real behavior wins), and which element takes which color (rules, text inside the rules,
  the waiting mark, gauges) — numbers without the assignment caused #8354's two misses (#8390).
- **Write in the body and the acceptance criteria that the new effect leaves the existing themes'
  look unchanged** (#8376).
- A look approved or changed → record its golden replay in that PR: `docs/josh-commands-board.md` →
  "`josh board:compare`".
- Demo-backed: a seam child, then parallel effect children ([split](theme-split.md)); each moves
  the demo's drawing in unchanged and places it by kit's layout ([wiring](theme-wiring.md)).

## 6. After the first merge

- **Compare the implementation's commit with the demo's code**, comment the matches and the
  differences on the Issue, and file each difference as a fix Issue — #8354's comparison caught three
  (#8390, #8391).
- Comment the real board's `--timing` values on the Issue once every effect child has merged:
  [render cost](render-cost.md) → "After every effect child has merged".

## Working rules

- Gather the points the user finds by eye and hand them over as one piece of work, in one brief that
  holds everything. Record on the Issue only the decisions that stay as the spec.
- Keep investigation and implementation in separate pieces of work; finish the implementation first.
- Never let two pieces of work touch the same file at once; files apart may go in parallel. The agent
  that built a theme also takes its fixes.
- While the look is being tuned, tests and the gate may wait with the user's explicit approval; the
  finish runs them all.
- Two defects of one shape → stop fixing one at a time; find that shape in every theme's code.
- Read a request no wider than it is: fixing a value shown as `--` changes no effect.

## Examples

- trace: epic #8357; demo code in its children's comments, #8352–#8370.
- wopr typing effect: epic #8377 (#8375, #8376); demo code:
  https://github.com/joshuafolkken/kit/issues/8376#issuecomment-7039783569
- Demo-vs-implementation comparison:
  https://github.com/joshuafolkken/kit/issues/8354#issuecomment-7039850496
