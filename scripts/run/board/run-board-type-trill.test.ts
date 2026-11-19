import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import type { CueName } from './run-board-sound-cues'
import type { TypingSound } from './run-board-sound-typing'
import { run_board_spin } from './run-board-spin'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8250: a redraw that brings a row to type switches the trill on, apart from the cue
// it may sound on the same frame; the spinner's turns keep it on while a row types and switch it off
// once every row is typed through.

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { spin_to_second } = run_board_spin
const SECOND = 1000
// Past the time the header's now line takes to type through.
const TYPED_MS = 10 * SECOND

interface Heard {
	cues: Array<CueName>
	trill: Array<boolean>
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
	const typing_sound = trill_of(heard)

	function cue(name: CueName): void {
		heard.cues.push(name)
	}

	const heard_ports = { ...ports, cue, typing_sound, types_rows: true }

	return drawn_from(state, LOCAL, { ports: heard_ports, now_ms }, run_layout)
}

// The trill switches the spinner's turns make from `now_ms` to the next second.
async function turned_from(state: BoardState, now_ms: number): Promise<Array<boolean>> {
	const heard: Heard = { cues: [], trill: [] }
	const clock = { now_ms }

	await spin_to_second(
		{ spots: [], typing: state.typing },
		{
			now: () => clock.now_ms,
			sleep: async (ms) => {
				clock.now_ms += ms
				await Promise.resolve()
			},
			write: () => undefined,
			typing_sound: trill_of(heard),
		},
	)

	return heard.trill
}

describe('run_board_tick_draw.draw_display trill', () => {
	it('switches the trill on as a row appears, with the cue on the same frame', () => {
		const heard: Heard = { cues: [], trill: [] }
		const base = heard_over(planned(), [], START, { cues: [], trill: [] })

		heard_over(base, running(), START + SECOND, heard)
		expect(heard).toStrictEqual({ cues: ['launch'], trill: [true] })
	})

	it('switches the trill off once every row is typed through', () => {
		const heard: Heard = { cues: [], trill: [] }
		const base = heard_over(planned(), [], START, { cues: [], trill: [] })
		const appeared = heard_over(base, running(), START + SECOND, { cues: [], trill: [] })

		heard_over(appeared, running(), START + TYPED_MS, heard)
		expect(heard.trill).toStrictEqual([false])
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
