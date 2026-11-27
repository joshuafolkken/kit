import { stripVTControlCharacters } from 'node:util'
import type { EventKind, TypingSound } from './run-board-sound-typing'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { PartName } from './run-board-theme-host-types'
import { run_board_theme_run, type ThemeRun } from './run-board-theme-run'

// A themed board's event sounds (joshuafolkken/kit#8917): the theme's sound of a NOTICE, a ROW or a
// PROGRESS plays once as it starts on the timeline drawn — the board's own events, or in demo mode the
// demo's — on the first frame at or past its start, however many ticks were skipped. Each sound is one
// WAV laid out on the event's own time line, so what follows the start sounds on time without another
// call. An event begun before the run's first frame stays silent. A part (the opening, the ending)
// sounds the same way, once as it starts.

const { part_ms, tick_at, timeline_at } = run_board_theme_run
const { code_points } = run_board_theme_host_grid
const KINDS: ReadonlyArray<EventKind> = ['notice', 'row', 'progress']
const PARTS: ReadonlyArray<PartName> = ['opening', 'ending']

interface Started {
	start: number
	letters: number
}

function letters_of(text: string): number {
	return code_points(stripVTControlCharacters(text)).length
}

// The latest `kind` event begun by `tick` and its text's length; start -1 where none has.
function latest(run: ThemeRun, kind: EventKind, tick: number): Started {
	const begun = timeline_at(run, tick)[kind].filter(({ start }) => start <= tick)
	const last = begun.toSorted((first, second) => second.start - first.start).at(0)

	if (last === undefined) return { start: -1, letters: 0 }

	return { start: last.start, letters: letters_of(last.text) }
}

// The `kind` event begun by `at_ms` later than the last one sounded, its start kept; none otherwise. A
// demo key starts its event on the tick it is pressed, so a frame already drawn in that tick does not
// hide it.
function started(run: ThemeRun, kind: EventKind, at_ms: number): Started | undefined {
	const found = latest(run, kind, tick_at(run, at_ms))
	const last = run.event_starts?.[kind]

	run.event_starts = { ...run.event_starts, [kind]: found.start }

	return last !== undefined && found.start > last ? found : undefined
}

function is_notice_started(run: ThemeRun, at_ms: number): boolean {
	return started(run, 'notice', at_ms) !== undefined
}

// The part begun since the last frame, played once.
function sound_part(run: ThemeRun, trill: Pick<TypingSound, 'part'> | undefined): void {
	const { part } = run

	if (part === undefined || part === run.part_sounded) return
	run.part_sounded = part
	trill?.part?.(part.name, part_ms(run, part.name))
}

// The theme's sounds through the trill's ports, for each event and part that started.
function sound_events(
	run: ThemeRun,
	trill: Pick<TypingSound, 'event' | 'part'> | undefined,
	at_ms: number,
): void {
	sound_part(run, trill)

	for (const kind of KINDS) {
		const found = started(run, kind, at_ms)

		if (found !== undefined) trill?.event?.(kind, found.letters)
	}
}

type Warming = Pick<TypingSound, 'warm_event' | 'warm_part'>

// The `kind` events due from `tick` on, by their text's length.
function due_letters(run: ThemeRun, kind: EventKind, tick: number): Array<number> {
	const due = timeline_at(run, tick)[kind].filter(({ start }) => start >= tick)

	return due.map(({ text }) => letters_of(text))
}

// Both parts' sounds rendered ahead once the theme is built.
function warm_parts(run: ThemeRun, trill: Warming): void {
	if (run.built === undefined) return
	for (const name of PARTS) trill.warm_part?.(name, part_ms(run, name))
}

// joshuafolkken/kit#9087: the sounds of every event due from `at_ms`'s tick on, and of both parts,
// rendered ahead as a frame is drawn — so the frame an event starts in only starts a sound already
// made. Rendered tracks are cached, so an event warmed again costs a lookup.
function warm_events(run: ThemeRun, trill: Warming | undefined, at_ms: number): void {
	if (trill === undefined) return
	const tick = tick_at(run, at_ms)

	for (const kind of KINDS) {
		for (const letters of due_letters(run, kind, tick)) trill.warm_event?.(kind, letters)
	}

	warm_parts(run, trill)
}

const run_board_theme_notice_sound = { is_notice_started, sound_events, sound_part, warm_events }

export { run_board_theme_notice_sound }
