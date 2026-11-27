# From video

Read from `SKILL.md` → "2. Measure the original" (the user's workflow, 2026-11-27).

## Aim

- The whole screen reads as the work — ground, rules, typography, cursors, panel — not only the
  events.
- A theme built from memory came out far from the work: measure on frames.

## Sources

- Search for the videos yourself.
- Prefer no-commentary gameplay; for sound, effect-only uploads. A fan compilation with voice and
  music measures badly.
- A fan-made re-design of the work's sounds or UI is not the original: skip it.
- `yt-dlp`: 480p to survey; 720p or more only for a section studied closely; audio separately.
- Keep videos, frames and clips under `.josh/tmp/scratch/<work>-video/`, never in the repository.
  Delete them when the work is done.

## Three passes

| Pass | Frames | Gives |
|---|---|---|
| Survey | One every 5 s, as contact sheets | Where the UI moments are |
| Scene | 4 to 8 a second over the 20 to 40 s found | The scene's parts, text and order |
| Motion | Every frame of one 1 to 3 s movement | Its steps, counted and written in ticks of 50 ms |

- Before looking: `ffmpeg` `signalstats` per frame; list the largest color jumps with their times —
  they find transitions a 5 s sample misses.
- One read-only survey agent per video, in parallel. Each returns a timed list of UI moments, the
  transitions worth frame-by-frame study, and what it could not read.
- Run the surveys in the background on a light model and keep replies short: the user is not kept
  waiting on a survey.
- An agent's time can be wrong: confirm it on a full-size frame before using it.

## What to look for

- UI the player sees often and remembers: the menu and its cursor, yes/no and choice lists,
  investigation or scan modes and the way the screen changes entering them, progress and analysis
  readouts, stamped text, the work's signature moment.
- Light-background screens count.

## Catalogue

- One HTML page in the scratch folder: per moment a thumbnail, a time link, one line, the board event
  it suits and the measured colors.

## Colors

- Read them from frame pixels: crop the part, scale it to 1×1.
- Label each "measured" or "by eye".

## Sound

- Cut a clip per effect by time with `ffmpeg`.
- Measure onsets, length, peak and the strongest partials: a small WAV script plus
  `showspectrumpic`.
- Write the values as the theme's computed sounds ([sound](theme-sound.md)).
- Give the user the play command for the original clip. You cannot hear: the user listens and
  corrects.
- A Mac plays every sound through one resident player; frames trail by its latency
  (`run-board-sound-resident.ts`, `run-board-sound-latency.ts`).
- Every sound of every theme late against the screen → check the output device before the code: a
  Bluetooth output adds its own delay; time `afplay` on a short silent file to see it (sync: #9087).

## Tooling

- `pnpm josh scratch:run` blocks child processes → run `yt-dlp` and `ffmpeg` from the shell.
- The scope hook refuses a shell function body, and a command substitution naming a file → a plain
  `for` loop and explicit names.
- Without `drawtext`, a contact-sheet tile's time is its index × the interval.
