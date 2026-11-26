# What a theme carries

Read from `SKILL.md` → "1. Pick the subject". Decide every item below before asking for approval. The
themes already in kit (`run-board-theme-<value>-*.ts`) are the examples.

## Checklist

| Item | Decide |
|---|---|
| Value and board name | The launch value, its aliases and the header's name (→ "Names and launch") |
| Capitals | Whether the board draws every letter in capitals (`capitals`) |
| Colors | Body, rules, marks (OK, red, yellow, bold white), letters being typed, the notice's letters |
| Level readout | The theme's own readout at the right end of the THROUGHPUT rule |
| Spinner | Ten glyphs of the work (→ "Spinner, colons and level readout") |
| IDLE | Motion inside the panel and one quiet screen-wide effect |
| PROGRESS, ROW, NOTICE | The three events' effects, showiness PROGRESS < ROW < NOTICE |
| OPENING, ENDING | How the board appears and goes |
| Sound | Every item of [sound](theme-sound.md) → "What a new theme decides" |
| Weight | A NOTICE frame's bytes ([render cost](render-cost.md) → "Frame weight") |
| Source check | Where each color, text and number comes from; write "unconfirmed" for what you could not check |

## Names and launch

- The board name is `josh-<value>`; the value is one short word naming the work's device or computer.
- The launch value is the board name after `josh-`. The work's full title and short names are aliases
  (`THEME_ALIASES`); the board holds the value only.
- Capitals: a work whose original screen is all capitals (a machine's view, a command room) draws in
  capitals; one with mixed case (subtitles, a PC screen) draws text as written. The board name follows.
- Gauge labels the theme draws itself may be capitals regardless. Two-letter marks (`BD`, `OK`) and
  headings (`CPU`, `MEM`) are capitals in every theme.
- Order: no theme is 0, then the themes in `THEME_DEFS` order; a new theme goes last.

## Events and showiness

| Tier | When | Use |
|---|---|---|
| IDLE | Nothing happens | The panel always moves; one quiet screen-wide effect (a color change or a few cells) |
| PROGRESS | Header row 3's progress changes; most frequent | Typing on the progress line and the panel's reaction; may use the whole area |
| ROW | A row changes (a lane added); medium | Clearly richer than PROGRESS; runs until the row has typed through |
| NOTICE | Header row 2's notice; rare | The special effect: the whole screen, plainly apart from the other two |

- Play the three side by side and check the steps between them.
- A mark or blink on a row repeats while the row types, not once at its start.
- Keep the best effect off the frequent events. A ROW need not show success; save the climax for
  NOTICE.
- Give the work one prop and grow it across the three events (PROGRESS a glimpse, ROW nearly there,
  NOTICE complete at the peak). What has settled stays settled; settled is bright, moving is dim, the
  moment of settling flashes white.
- Priority is NOTICE > ROW > PROGRESS. A higher event switches at once; the same tier restarts its
  effect; a lower one shows its text only.
- PROGRESS's area effects are rate-limited by one constant (default: every progress).
- The notice line keeps the notice color after its event; the progress line eases back to the base
  color after typing through.

## Where to draw

| Place | When |
|---|---|
| Right of THROUGHPUT and USAGE (the panel) | Always |
| THROUGHPUT and USAGE whole, rules included | During an event; the data there may be overwritten |
| The whole screen (color, flash, glitch, rain) | During an event; in IDLE one quiet effect only |
| Header's left three columns, the pinned right column, row 1's CPU / MEM / SWAP | NOTICE only, once the areas are used up |
| Header row 2's notice text and row 3's progress text | Recolor only; draw nothing over them |
| The free seat rows under LANES | Never |

- Use THROUGHPUT and USAGE before the header. Show one piece of information in one place.
- The notice text itself may carry a typing effect; it stays readable.

## Timing

| NOTICE | Notice text | Effect |
|---|---|---|
| 0 to 4 s | Types at the board's pace, then waits | Builds for four seconds whatever the length |
| 4 s | The first blink starts | The peak; the biggest spark here |
| 4 to 9 s | Three blinks, one second on, one off | Afterglow; something keeps moving besides the blinks |
| 10 s | — | Back to the normal display |

- A work whose after-peak does not fit may lengthen its NOTICE (`lasts: { n }` on its module). The
  peak at four seconds, the peak's spark and the three blinks stay. A last line to read types fast,
  then holds.
- PROGRESS and ROW end shortly after typing through; do not stretch them.
- Frames follow elapsed time; a late frame is skipped, never drawn later.

## IDLE

- Panel: two or three motions on different periods (always moving, every few seconds).
- Screen: one quiet effect; it may keep running through events where it does not clash, else it stops.
- Speed may follow activity (IDLE < PROGRESS < ROW).
- Check the motion is calm and fits the work; gauges snap in steps, overshoot a little and settle.

## OPENING and ENDING

- Four to seven seconds; ENDING may be shorter.
- The last OPENING frame equals the normal board cell for cell. ENDING ends on an empty screen held
  about a second.
- Any key skips the OPENING; Ctrl-C plays the ENDING and any key ends it at once.
- No theme has neither: it appears and goes at once.

## Spinner, colons and level readout

- Every theme spins: at kit's places (header row 3's code column, each running lane's first cell),
  kit's period and ten frames, in the work's glyphs. Effects may hide it; it never covers a two-letter
  mark; it never shows on a row a ROW has not opened yet. Redraws must not wipe it.
- The header clocks' colons blink in every theme; an effect's own cells are left alone.
- The level readout is the theme's own; it ends on the rule's right edge, the rule's line fills its
  left. A theme with a value shows the real alert level normally and its effect's value during events.

## No theme

- Moves only what kit moves: the braille spinner, the clocks' colons, the per-second update.
- NOTICE, PROGRESS and ROW show at once, bold cyan just after; no typing, blink band or effect.
- Its base is taken in no theme (emoji two cells wide, the terminal's colors, faint rules).
