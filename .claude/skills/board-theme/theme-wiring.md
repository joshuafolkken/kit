# Move a confirmed demo into kit

Read from `SKILL.md` → "5. File the Issue once the user decides". The demo confirms the look; kit
places it.

## What is right

- The look (drawings, colors, motion, timing) is the confirmed demo's. Kit shows it without dropping
  a cell; "about the same" is not done.
- Move the drawing code without changing its shape: no rebuild, no simplification, no lookalike.
- A theme replaced by a new demo takes the demo's effects whole; delete the code of effects no longer
  used.
- **Places are kit's, not the demo's.** The demo's base is one still frame; the live board differs
  (folding marks on rules, any lane count, folded sections). Find each place from kit's layout (the
  section headings' rows, the areas, the lanes' rows, the header's columns) and the cells' roles, never
  from the demo's text or row numbers.
- Changes the user decides after the demo are deliberate differences: keep them as a list.

## Layout rules

- The header's first column has a minimum width; the board name's length moves nothing.
- The pinned right column is fixed; the notice text stops short of it.
- Folded sections and a small terminal keep the theme's look (colors, capitals, name, marks, spinner,
  level readout, rule effects, header). Only area effects skip where there is no room, never half
  drawn. Only a terminal without 24-bit color falls back to no theme.
- Theme effects draw while the run is stopped; only the spinner follows the run.
- Capitals keep links.
- Switching themes shows only the chosen theme from the next frame (the base redrawn at once).

## Check it

- Report something as fixed only after drawing it on bases of the real board's shape. Code written or
  a match on the demo's base is "unchecked".
- Bases, at least: three lanes all open, no lane, folded sections, the run stopped.
- Compare with the demo: same theme, same event, same frame, every row, text and each cell's color.
  Compare OPENING, ENDING and the normal display outside demo mode too.
- A match on the demo's base proves nothing about the real board; check both.
- Report in parts: "place and text checked, color checked as far as the tool shows, motion and sound
  unchecked".
- When the user's eyes and your reading disagree, the eyes are the fact: find the cause in code.
- Read a video as frames (`ffmpeg -vf fps=2`); a side-by-side recording may be out of sync.

## Demo mode (hidden, inside the live board)

- `/` enters and leaves it. In demo mode the frame ends on the demo footer (the theme picked, what
  plays, every key) in place of the legend and the footer: `scripts/run/board/run-board-demo-footer.ts`.
- Adding a theme → its `playing` (`ThemeModule`, `run-board-theme-host-types.ts`); checked by
  `scripts/run/board/run-board-theme-playing.test.ts`.
- Keys: `0` to `7` pick a theme, `s` IDLE, `a` PROGRESS, `d` ROW, `w` NOTICE, `q` OPENING, `e` ENDING.
- It enters on the current theme's IDLE. Leaving on another theme keeps it and saves it to `.env`
  (`JOSH_BOARD_THEME`).
- With no lane, sample lane rows show the ROW; folded LANES open while in demo mode and return after.
- Sample text types to the field's full width.
- Sound: the key's effect sounds, the real events behind it do not ([sound](theme-sound.md)).
- There is no separate demo command: check the look in demo mode on the live board.
