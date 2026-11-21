import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3689: the header is written the same while the run works and while it waits. The
// wait is read off the mark, and neither line gains a part for it. joshuafolkken/kit#8475: a run quiet
// past its heartbeat says so in the notice slot, not in a time cell under the run's `⏰`.
// What these cases pin is the header in each of the four states a run can be in: waiting, running,
// waiting on a person, and ended.

const { minute_of } = run_board_labels
const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const MACHINE_UNKNOWN = '💪 -  🧠 -  💾 -'
const EMPTY_BAR = '─'.repeat(10)
const COUNTS = `✅  0/0 ${EMPTY_BAR}  🔄 0  ⏳ 0  💤 0`
// The second line's name column with no kit version recorded: `-` under the board's name.
const VERSION_CELL = '  -'.padEnd('⏸ josh-board'.length)
// The time cell a running run leaves blank, as wide as the `⏰ 2°10′00″` over it.
const BLANK_TIME = ' '.repeat(run_board_fit.width_of('⏰ 2°10′00″'))
const SLOT_BLANK = '—'
// The run's last event is 5°35′49″ old: the wait has gone on past any heartbeat, and the slot says so.
const WAITED_MINUTES = 335
const WAITED_SECONDS = 49
const WAITED = WAITED_MINUTES * MINUTE + WAITED_SECONDS * SECOND
const WAITING = { last_event_ms: NOW - WAITED, is_stopped: false }
const BEAT_LINE = `${VERSION_CELL}  ${BLANK_TIME}  ${MACHINE_UNKNOWN}  ❗ no heartbeat ${WAITED_MINUTES}′`
const WAIT_GLYPHS = /[⏸⌛]/u

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

const RUNNING_LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }
const PEOPLE_LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

function clock_of(layout: BoardLayout): string | undefined {
	return lines_of(header({ activity: WAITING, layout }))[1]
}

describe('run_board_render.render — the header while the run waits', () => {
	it('draws the wait as the mark and the missed heartbeat in the notice slot', () => {
		expect(lines_of(header({ activity: WAITING })).slice(0, 2)).toStrictEqual([
			`⏸ josh-board  ⏰ 2°10′00″  ${COUNTS}`,
			BEAT_LINE,
		])
	})

	it.each([
		['a few minutes', 3 * MINUTE + 58 * SECOND, SLOT_BLANK],
		['a second short of an hour', 59 * MINUTE + 59 * SECOND, '❗ no heartbeat 59′'],
		['over an hour', WAITED, `❗ no heartbeat ${WAITED_MINUTES}′`],
	])('says the heartbeat in the notice slot after %s', (_span, waited, drawn) => {
		const activity = { last_event_ms: NOW - waited, is_stopped: false }

		expect(lines_of(header({ activity }))[1]).toBe(
			`${VERSION_CELL}  ${BLANK_TIME}  ${MACHINE_UNKNOWN}  ${drawn}`,
		)
	})

	it('draws the second line of a waiting run as it draws a running run’s', () => {
		const running = lines_of(header({ activity: WAITING, layout: RUNNING_LAYOUT }))

		expect(running[0]).toMatch(/^▶ josh-board/u)
		expect(clock_of(EMPTY_LAYOUT)).toBe(running[1])
	})

	it('marks a run waiting on a person ✋ and changes nothing on the second line', () => {
		const lines = lines_of(header({ activity: WAITING, layout: PEOPLE_LAYOUT }))

		expect(lines[0]).toMatch(/^✋ josh-board {2}⏰ 2°10′00″ {2}✅ {2}0\/1 /u)
		expect(lines[1]?.replace(/^ +- +/u, '')).toBe(BEAT_LINE.replace(/^ +- +/u, ''))
	})

	it.each([
		['waiting', EMPTY_LAYOUT],
		['waiting on a person', PEOPLE_LAYOUT],
		['running', RUNNING_LAYOUT],
	])('draws no wait part on the second line while %s', (_state, layout) => {
		expect(clock_of(layout)).not.toMatch(WAIT_GLYPHS)
	})
})

describe('run_board_render.render — the header once the run has ended', () => {
	it('draws the minute an ended run ended under its length, and no heartbeat', () => {
		const ended_ms = STARTED + 3 * MINUTE + 25 * SECOND
		const activity = { last_event_ms: ended_ms, is_stopped: true }
		const lines = lines_of(header({ activity, ended_ms }))

		expect(lines.slice(0, 2)).toStrictEqual([
			`■ josh-board  ⏰ 3′25″  ${COUNTS}`,
			`${VERSION_CELL}  🔚 ${minute_of(ended_ms)}  ${MACHINE_UNKNOWN}  ${SLOT_BLANK}`,
		])
	})
})
