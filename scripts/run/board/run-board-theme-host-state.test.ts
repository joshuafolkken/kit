import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, ThemeState } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the theme host's event state against the confirmed theme demo's. The
// demo side is the state the demo host's own `state_of` gave for its events at a spread of ticks,
// recorded in `__snapshots__/run-board-theme-host-probe.json` (see the frame test for how).

const { HOST } = run_board_theme_host_fixture
const { active, channel, finished, held, state_of, ticks_of, total_of, typed_ticks } =
	run_board_theme_host_state
const { FAR, NOTICE_END, PEAK_TICKS, TRACE_END } = run_board_theme_host_state

const PROBE_URL = new URL('__snapshots__/run-board-theme-host-probe.json', import.meta.url)
const STATES = (JSON.parse(readFileSync(PROBE_URL, 'utf8')) as { states: Record<string, unknown> })
	.states

function without_span({ span: _span, ...rest }: Channel): Omit<Channel, 'span'> {
	return rest
}

// The state as the demo probe recorded it: channels without their span, the summary, the total.
// Compared as JSON, an absent icon reads as the demo's.
function recorded(state: ThemeState): unknown {
	const { notice, notice_text, progress, row, busy, latest, since, last_start, busy_ticks, done } =
		state
	const channels = {
		notice: without_span(notice),
		notice_text: without_span(notice_text),
		progress: without_span(progress),
		row: without_span(row),
	}
	const summary = { busy, latest, since, last_start, busy_ticks, done, total: state.event.total }

	return { ...channels, ...summary }
}

describe('run_board_theme_host_state.state_of against the demo host', () => {
	it('gives every recorded channel and summary the demo gave', () => {
		const keys = Object.keys(STATES)
		const differing = keys.filter((key) => {
			const event = HOST.events[key.slice(0, 1) as 'a' | 'i' | 'n' | 'p' | 'r']
			const state = state_of(HOST.layout, event, Number(key.slice(1)))

			return JSON.stringify(recorded(state)) !== JSON.stringify(STATES[key])
		})

		expect(keys).toHaveLength(75)
		expect(differing).toStrictEqual([])
	})

	it('peaks a NOTICE eighty ticks after it starts, whatever its length', () => {
		const at_peak = state_of(HOST.layout, HOST.events.n, 10 + PEAK_TICKS - 1)

		expect(at_peak.notice).toMatchObject({ is_typing: false, cooled: 0, total: PEAK_TICKS })
		expect(at_peak.notice_text.is_typing).toBe(false)
		expect(at_peak.latest).toBe('notice')
	})
})

describe('run_board_theme_host_state timing', () => {
	it('keeps the demo host’s timing constants', () => {
		const host = run_board_theme_host_state
		const timing = [host.TICK_MS, host.PEAK_TICKS, host.GAP_TICKS, host.NORMAL_FROM, host.LINGER]
		const trace = [host.TRACE_ON, host.TRACE_EVERY, host.TRACE_END, host.NOTICE_END, host.FAR]

		expect(timing).toStrictEqual([50, 80, 40, 5000, 0])
		expect(trace).toStrictEqual([20, 40, 100, 120, 9999])
	})
})

describe('run_board_theme_host_state.channel', () => {
	const span = { y: 0, x: 0, end: 6 }

	it('has not started before its first message', () => {
		expect(channel('row', [{ start: 5, text: 'abc' }], { span, tick: 4 })).toMatchObject({
			index: -1,
			is_typing: false,
			cooled: FAR,
			start: -FAR,
		})
	})

	it('types a letter a tick, cut to its span, then cools from the tick the last letter lands', () => {
		const messages = [{ start: 5, text: 'abcdefgh', icon: '> ' }]

		expect(channel('progress', messages, { span, tick: 6 })).toMatchObject({
			length: 2,
			is_typing: true,
			cooled: 0,
		})
		expect(channel('progress', messages, { span, tick: 9 })).toMatchObject({
			length: 5,
			total: 5,
			is_typing: false,
			cooled: 0,
			text: 'abcde',
			icon: '> ',
		})
		expect(channel('progress', messages, { span, tick: 12 }).cooled).toBe(3)
	})
})

describe('run_board_theme_host_state counts', () => {
	it('sums the ticks spent typing and the held notice’s fixed length', () => {
		const span = { y: 0, x: 0, end: 10 }

		expect(total_of('abcdefghijkl', span)).toBe(9)
		expect(
			typed_ticks(
				[
					{ start: 0, text: 'abc' },
					{ start: 10, text: 'ab' },
				],
				span,
				11,
			),
		).toBe(5)
		expect(held([{ start: 3, text: 'x' }])).toStrictEqual([
			{ start: 3, text: 'x', ticks: PEAK_TICKS },
		])
		expect(ticks_of(HOST.layout, HOST.events.i, FAR)).toBe(0)
	})

	it('reads a channel active while it types and `tail` ticks after, and counts what finished', () => {
		const state = state_of(HOST.layout, HOST.events.n, 10 + PEAK_TICKS + NOTICE_END - 2)

		expect(active(state.notice, NOTICE_END)).toBe(true)
		expect(active(state.notice, TRACE_END)).toBe(false)
		expect(finished(state.notice)).toBe(1)
		expect(finished(state.progress)).toBe(0)
	})
})
