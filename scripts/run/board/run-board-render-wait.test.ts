import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3689: the header is written the same while the run works and while it waits. The
// wait is read off the mark and the `💓` that counts on from the run's last event, and neither line
// gains a part for it. joshuafolkken/kit#3692: the `💓` stands under the run's `⏰`, in one column.
// What these cases pin is the header in each of the four states a run can be in: waiting, running,
// waiting on a person, and ended.

const { minute_of } = run_board_labels
const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const MACHINE_UNKNOWN = '⚡ -  🧠 -  💾 -'
const EMPTY_BAR = '─'.repeat(10)
const COUNTS = `✅  0/0 ${EMPTY_BAR}  🔄 0  ⏳ 0  💤 0`
// The second line's name column with no repository to name.
const NAME_BLANK = ' '.repeat('⏸ backlogrun'.length)
const BEAT_LINE = `${NAME_BLANK}  💓 5°35′49″  ${MACHINE_UNKNOWN}`
// The run's last event is 5°35′49″ old: the wait has gone on that long, and the `💓` says so.
const WAITED_MINUTES = 335
const WAITED_SECONDS = 49
const WAITED = WAITED_MINUTES * MINUTE + WAITED_SECONDS * SECOND
const WAITING = { last_event_ms: NOW - WAITED, is_stopped: false }
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
	it('draws the wait as the mark and, under the run’s age, the age of the last event', () => {
		expect(lines_of(header({ activity: WAITING })).slice(0, 2)).toStrictEqual([
			`⏸ backlogrun  ⏰ 2°10′00″  ${COUNTS}`,
			BEAT_LINE,
		])
	})

	it.each([
		['under an hour', 3 * MINUTE + 58 * SECOND, '💓    3′58″'],
		['a second short of an hour', 59 * MINUTE + 59 * SECOND, '💓   59′59″'],
		['over an hour', WAITED, '💓 5°35′49″'],
	])('draws the age as the ⏰ is drawn, padded to its width, %s', (_span, waited, drawn) => {
		const activity = { last_event_ms: NOW - waited, is_stopped: false }

		expect(lines_of(header({ activity }))[1]).toContain(`${NAME_BLANK}  ${drawn}  `)
	})

	it('draws the second line of a waiting run as it draws a running run’s', () => {
		const running = lines_of(header({ activity: WAITING, layout: RUNNING_LAYOUT }))

		expect(running[0]).toMatch(/^▶ backlogrun/u)
		expect(clock_of(EMPTY_LAYOUT)).toBe(running[1])
	})

	it('marks a run waiting on a person ✋ and changes nothing on the second line', () => {
		const lines = lines_of(header({ activity: WAITING, layout: PEOPLE_LAYOUT }))

		expect(lines[0]).toMatch(/^✋ backlogrun {2}⏰ 2°10′00″ {2}✅ {2}0\/1 /u)
		expect(lines[1]?.trimStart()).toBe(BEAT_LINE.trimStart())
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
	it('draws the minute an ended run ended under its length, where the 💓 stood', () => {
		const ended_ms = STARTED + 3 * MINUTE + 25 * SECOND
		const activity = { last_event_ms: ended_ms, is_stopped: true }
		const lines = lines_of(header({ activity, ended_ms }))

		expect(lines.slice(0, 2)).toStrictEqual([
			`■ backlogrun  ⏰ 3′25″  ${COUNTS}`,
			`${NAME_BLANK}  🔚 ${minute_of(ended_ms)}  ${MACHINE_UNKNOWN}`,
		])
	})
})
