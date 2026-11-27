# A theme's sounds

Read from `SKILL.md` and [what a theme carries](theme-rules.md). You cannot hear: decide sounds by
waveform values (pitch, length, peak, order), check the play calls' count and timing and the values,
and write "unchecked by ear". The user listens and adjusts.

## Rules

- Showiness by ear follows the screen: PROGRESS < ROW < NOTICE in the number, length and loudness of
  sounds.
- Every theme has its own sounds; never reuse another theme's. No theme sounds too (its look stays).
- A notice plays its theme's call only — never the shared cue on top of it.
- Typing and the other sounds may overlap.
- Each sound plays at a fixed moment on the event's time line, the screen's; a one-time sound plays
  once however many frames are skipped.
- The sound switch (`s`) silences every sound.
- In demo mode the effect a key starts sounds; the real events behind it do not.
- No recorded file: every sound is a computed waveform.

## Per event

| Event | Sounds |
|---|---|
| PROGRESS | Quiet: typing, and a typed end if the theme has one. No start sound |
| ROW | Typing, plus a start, a sound while it types (on the screen's beats: a digit settling, a frame closing, a blink) and a typed end |
| NOTICE | Call → typing → a bed rising in pitch and pace to the peak → the peak → a sound on each blink, the bed between → a close. Something sounds until the effect ends |
| OPENING | Typing and a typed end where it types; a bed elsewhere; one sound as the board appears |
| ENDING | The bed sinking and slowing; one sound as the screen goes |
| IDLE | Silent |

- The bed is quieter than the call and the typing: start around half the call's peak.
- No theme shows text at once, so it plays one short sound as each event shows, not a typing loop.

## The original's sound

The user's split (2026-11-27):

| Kind | Rule |
|---|---|
| Sound effect (a beep, a click, a ping, an alarm, static, a hum) | Imitate with high fidelity from measured values: partials, length, envelope, order |
| Music (a melody, a theme's rhythm, a cue from the score) | Never copy. Make a melody from the original's motif with a small change |

- A sound effect, even one made of a few notes and a few seconds long, is reproduced as it is. What
  gets arranged (the original's motif with a small change) is music: a main melody, a theme, a cue
  from the score.
- For every effect on screen, find the sound that stands for it in the original and make it. Decide
  yourself which sounds the theme adopts.
- Sounds are measured from clips: [from video](theme-video.md) → "Sound".
- The package ships the sounds.

## Loudness

- Take the teletype typing's peak (about 0.14 of full scale) as the reference.
- NOTICE's peak is the loudest (about 0.22), still not sudden; the call about 0.16; ROW's sounds about
  0.11; PROGRESS's typed end about 0.09; the bed about half the call.

## How kit plays them

- `THEME_DEFS` (`run-board-theme-defs.ts`): `typing` (the trill's loop), `typed_end` (the opening's
  typed end) and `score: score_of(<palette>)`.
- A palette is data (`run-board-sound-palettes-*.ts`): one-shot sounds of tones, noise and rests
  (`run-board-sound-voice.ts` → `Sound`) and beds of pulses and a drone (`Bed`). Build from the shared
  parts (`run-board-sound-voice.ts`, `run-board-sound-shape.ts`); write no per-theme copy of them.
- Each event plays one WAV from its start (`run-board-sound-score.ts`): what overlaps on its time line
  is mixed into it beforehand. The start is found on the timeline drawn
  (`run-board-theme-notice-sound.ts`), so demo mode sounds its own events.
- `opening_cues` mix into the OPENING's track at their `at_ms` (`run-board-sound-score.ts`).
- A Mac plays every sound through one resident player; frames trail by its latency
  (`run-board-sound-resident.ts`, `run-board-sound-latency.ts`).
- No theme plays the board's cues (`run-board-sound-cues.ts`): a click for a row or progress line, two
  soft rising notes for a notice. A shown theme mutes them.

## What a new theme decides

Decide with the look: typing, typed end, NOTICE's call, bed, peak, blink sound and close, ROW's start,
its sound while typing (on which beats) and its end, whether PROGRESS has a typed end, and the
OPENING's and ENDING's sounds.

## Checking

- Report per theme and event: pitch, length, peak and when it plays.
- Record the play calls of one NOTICE, one ROW and one PROGRESS: one call each, at the event's start.
- Write "unchecked by ear" and give the user the steps to listen (restart the board, demo mode keys).
- Every sound of every theme late against the screen → check the output device before the code: a
  Bluetooth output adds its own delay; time `afplay` on a short silent file to see it (sync: #9087).
