import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import type { BoardRow } from './run-board-layout'
import type { CueName } from './run-board-sound-cues'
import { run_board_sound_typing, type TypingSound } from './run-board-sound-typing'
import type { BoardState } from './run-board-state'
import type { Theme } from './run-board-theme'
import { run_board_tick } from './run-board-tick'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8250: a redraw that brings a row to type switches the trill on, apart from the cue
// it may sound on the same frame; the spinner's turns keep it on while a row types and switch it off
// once every row is typed through.

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { spin_to_second } = run_board_frame_fixture
const SECOND = 1000
// Past the time the header's now line takes to type through.
const TYPED_MS = 10 * SECOND

interface Heard {
	cues: Array<CueName>
	trill: Array<boolean>
	// A trill that sounds, in place of the one that only records its switches.
	sound?: TypingSound
	// The board's theme, none by default (joshuafolkken/kit#8365).
	theme?: Theme
}

// The trill as the board sounds it, its player faked; the stop timer runs on vitest's fake timers.
function sounding(): { sound: TypingSound; kill: Mock<() => unknown> } {
	const kill = vi.fn<() => unknown>()
	const sound = run_board_sound_typing.typing_sound({
		file: () => 'teletype.wav',
		start: (_file, handlers) => {
			handlers.started({ on: () => undefined, unref: () => undefined, kill })
		},
	})

	return { sound, kill }
}

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
}

function running(): Array<BoardRow> {
	return [
		{
			number: 1,
			title: undefined,
			kind: undefined,
			state: 'running',
			status: undefined,
			waits: [],
		},
	]
}

function trill_of(heard: Heard): TypingSound {
	return {
		set: (is_on) => {
			heard.trill.push(is_on)
		},
		stop: () => {
			heard.trill.length = 0
		},
	}
}

// A themed redraw over `rows` at `now_ms`, its cues and trill switches recorded in `heard`.
function heard_over(
	state: BoardState,
	rows: ReadonlyArray<BoardRow>,
	now_ms: number,
	heard: Heard,
): BoardState {
	const { ports } = harness(LOCAL, [])
	const run_layout = { ...layout_for(state, LOCAL, START), active: rows }
	const typing_sound = heard.sound ?? trill_of(heard)

	function cue(name: CueName): void {
		heard.cues.push(name)
	}

	const heard_ports = {
		...ports,
		cue,
		typing_sound,
		types_rows: true,
		opened_ms: START,
		theme: heard.theme,
	}

	return drawn_from(state, LOCAL, { ports: heard_ports, now_ms }, run_layout)
}

// The trill switches the spinner's turns make from `now_ms` to the next second.
// The spinner's turns from `clock.now_ms` to the next second over `typing_sound`; each sleep moves
// vitest's fake timers with the board's clock.
async function spun_from(
	state: BoardState,
	clock: { now_ms: number },
	typing_sound: TypingSound,
): Promise<void> {
	await spin_to_second(
		{ spots: [], typing: state.typing },
		{
			now: () => clock.now_ms,
			sleep: async (ms) => {
				clock.now_ms += ms
				vi.advanceTimersByTime(ms)
				await Promise.resolve()
			},
			write: () => undefined,
			typing_sound,
		},
	)
}

function appeared_at(now_ms: number): BoardState {
	const base = heard_over(planned(), [], START, { cues: [], trill: [] })

	return heard_over(base, running(), now_ms, { cues: [], trill: [] })
}

// When the rows `state` types finish, read at `now_ms`.
function typed_through(state: BoardState, now_ms: number): number {
	return now_ms + run_board_type_rows.left_ms(state.typing, now_ms)
}

async function turned_from(state: BoardState, now_ms: number): Promise<Array<boolean>> {
	const heard: Heard = { cues: [], trill: [] }

	await spun_from(state, { now_ms }, trill_of(heard))

	return heard.trill
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

// joshuafolkken/kit#8917: the redraw sounds the cue; the trill is the spin's, switched from its first
// frame on, as the theme layer types the rows.
describe('run_board_tick_draw.draw_display trill', () => {
	it('sounds the cue as a row appears, leaving the trill to the spin', () => {
		const heard: Heard = { cues: [], trill: [] }
		const base = heard_over(planned(), [], START, { cues: [], trill: [] })

		heard_over(base, running(), START + SECOND, heard)
		expect(heard).toStrictEqual({ cues: ['launch'], trill: [] })
	})

	// joshuafolkken/kit#8457
	it('switches the trill on in the spin as the live plan lands on the saved one’s frame', async () => {
		const saved = { ...planned(), fetched_ms: START - SECOND }
		const base = heard_over(saved, [], START, { cues: [], trill: [] })
		const landed = heard_over({ ...base, fetched_ms: START + SECOND }, [], START + SECOND, {
			cues: [],
			trill: [],
		})

		const [first] = await turned_from(landed, START + SECOND)

		expect(first).toBe(true)
	})
})

describe('run_board_spin.spin_to_second trill', () => {
	it('keeps the trill on while a row types, and off once it is typed through', async () => {
		const base = heard_over(planned(), [], START, { cues: [], trill: [] })
		const appeared = heard_over(base, running(), START + SECOND, { cues: [], trill: [] })
		const typing = await turned_from(appeared, START + SECOND)
		const typed = await turned_from(appeared, START + TYPED_MS)

		expect(typing.length).toBeGreaterThan(0)
		expect(typing[0]).toBe(true)
		expect(typed.every((is_on) => !is_on)).toBe(true)
	})
})

// joshuafolkken/kit#8523: the gather the board waits on between seconds draws nothing, so the trill
// stops by itself as the letters type through rather than at the next redraw.
describe('run_board_type_trill held gather', () => {
	it('stops the trill as a line typing past the second ends, while the gather holds the redraw', async () => {
		const { sound, kill } = sounding()
		const appeared = appeared_at(START + SECOND)
		const done_ms = typed_through(appeared, START + SECOND)
		const clock = { now_ms: START + SECOND }

		await spun_from(appeared, clock, sound)
		expect(done_ms).toBeGreaterThan(clock.now_ms)
		vi.advanceTimersByTime(done_ms - clock.now_ms - 1)
		expect(kill).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(kill).toHaveBeenCalledOnce()
	})
})
