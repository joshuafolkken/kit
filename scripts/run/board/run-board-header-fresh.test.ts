import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fresh } from './run-board-fresh'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { BoardLayout } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#3784: the header's third line's time and words are emphasized for about three
// seconds after they update — on a live screen only.

const { EMPTY_LAYOUT, NOW, header } = run_board_render_fixture
const { paint } = run_board_fresh
const SECOND = 1000
const INVERSE = 'inverse'
const BOLD_COLOR = 'bold-color'
const SPINNER = '⠙'
const SAID = '#278 merged'
const RUNNING_LAYOUT: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [
		{
			number: 1,
			title: 'Issue 1',
			kind: undefined,
			state: 'running',
			status: undefined,
			waits: [],
		},
	],
}

// The raw lines of a running run whose newest event is `age_ms` old.
function beating(age_ms: number, extra: Partial<BoardHeader> = {}): Array<string> {
	const activity = { last_event_ms: NOW - age_ms, is_stopped: false }

	return run_board_header.header_lines(
		header({ layout: RUNNING_LAYOUT, activity, spinner: SPINNER, ...extra }),
	)
}

// The raw third line of a stopped run whose newest event, `#278 merged`, is `age_ms` old.
function said(age_ms: number): string {
	const at_ms = NOW - age_ms
	const activity = {
		last_event_ms: at_ms,
		is_stopped: true,
		latest: { text: SAID, at_ms },
	}

	return run_board_header.header_lines(header({ activity, spinner: SPINNER }))[2] ?? ''
}

// joshuafolkken/kit#8475: the second line draws no heartbeat, so a fresh event changes none of it.
describe('run_board_header.header_lines fresh event', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('draws the second line as it stands whatever the newest event’s age', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(beating(0)[1]).toBe(beating(3 * SECOND)[1])
		expect(beating(0)[1]).not.toContain('💓')
	})

	it('keeps every column where it stands while an event is fresh', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const plain = beating(0, { spinner: undefined }).map((line) => stripVTControlCharacters(line))
		// A live frame draws its clocks' colons lit (joshuafolkken/kit#8476).
		const fresh = beating(0).map((line) =>
			stripVTControlCharacters(run_board_spot.drawn(line, SPINNER)),
		)

		expect(fresh.slice(0, 2)).toStrictEqual(plain.slice(0, 2))
	})
})

describe('run_board_header.header_lines fresh third line', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('emphasizes the third line time and words as they update, then draws them plain', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(said(0)).toContain(paint('0″', INVERSE))
		expect(said(0)).toContain(paint(SAID, INVERSE))
		expect(said(SECOND)).toContain(paint(SAID, BOLD_COLOR))
		expect(said(3 * SECOND)).toContain(` ${SAID}`)
		expect(said(3 * SECOND)).not.toContain(paint(SAID, 'bold'))
	})

	it('lets an ended run whose last words came just before its end settle once its end is past', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const at_ms = NOW - 10 * SECOND
		const activity = { last_event_ms: at_ms, is_stopped: true, latest: { text: SAID, at_ms } }
		const ended = header({ activity, spinner: SPINNER, ended_ms: at_ms })
		const third = run_board_header.header_lines(ended)[2] ?? ''

		expect(third).toContain(` ${SAID}`)
		expect(third).not.toContain(paint(SAID, INVERSE))
		expect(third).not.toContain(paint('0″', INVERSE))
	})
})
