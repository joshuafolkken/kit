import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { ClosedAnswer, ClosedIssue } from './run-board-closed'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3958: a child parked and then closed by a person stayed drawn 💤 and counted in the
// header's `💤 N`. Read closed from GitHub, it is drawn as it closed and leaves the parked count.

const { LOCAL, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const ISSUE = 3902
const TITLE = 'Overlap the review'
const LAUNCHED_AT = '2026-10-16T04:00:00.000Z'
const PARKED_AT = '2026-10-16T04:24:00.000Z'
const CLOSED_MS = Date.parse('2026-10-16T04:57:00.000Z')

function event_of(pos: number, at: string, kind: string, verb: string): RunEvent {
	return { pos, at, kind, text: `#${String(ISSUE)} ${verb}` }
}

function local_parked(verb: string): typeof LOCAL {
	return {
		...LOCAL,
		events: [
			event_of(1, LAUNCHED_AT, 'child-launch', 'launched'),
			event_of(2, PARKED_AT, 'park', verb),
		],
	}
}

const LOCAL_PARKED = local_parked('parked (needs-decision)')
// A listing read whole that no longer holds the child.
const PLAN: BoardPlan = {
	waves: { waves: [], unreached: [] },
	tracked: new Map(),
	context: { repo: 'joshuafolkken/kit', titles: new Map(), open_numbers: new Set() },
	labels: new Map(),
}

function answer_of(closed: Partial<ClosedIssue>): ClosedAnswer {
	const issue: ClosedIssue = {
		title: TITLE,
		labels: [],
		closed_ms: CLOSED_MS,
		is_merged: false,
		is_not_planned: false,
		...closed,
	}

	return { closed: new Map([[ISSUE, issue]]), is_whole: true }
}

async function frame_after(answer: ClosedAnswer, local = LOCAL_PARKED): Promise<Array<string>> {
	const { ports, frames, read_closed } = harness(local, [PLAN])

	read_closed.mockResolvedValue(answer)
	await tick(FRESH_STATE, ports)

	return (frames.at(-1) ?? '').split('\n')
}

function row_of(lines: ReadonlyArray<string>): string | undefined {
	return lines.find((line) => line.includes(String(ISSUE)))
}

describe('run_board_tick.tick — a parked child a person closed', () => {
	it.each<[string, Partial<ClosedIssue>, string]>([
		['withdrawn when closed as not planned', { is_not_planned: true }, '🚫'],
		['merged when a merge closed it', { is_merged: true }, '✅'],
	])('draws it %s and leaves it out of the parked count', async (_label, closed, icon) => {
		const lines = await frame_after(answer_of(closed))

		// Timed launch to park: the wait on a person after the park is off the lanes (#4463).
		expect(row_of(lines)).toMatch(
			new RegExp(String.raw`${icon} \d\d-\d\d \d\d:\d\d ${String(ISSUE)} +${TITLE} +24′00″$`, 'u'),
		)
		expect(lines[0]).toContain('💤 0')
	})

	it('draws it without a time when its close time could not be read', async () => {
		const lines = await frame_after(answer_of({ is_not_planned: true, closed_ms: undefined }))

		expect(row_of(lines)).toMatch(new RegExp(`🚫 {13}${String(ISSUE)} +${TITLE}$`, 'u'))
	})

	// joshuafolkken/kit#4099: its park waits on a decision, so its row is drawn 🙋 and counted with the
	// rows still to come, as an untouched needs-decision row is.
	it('keeps a child still open on a decision and counted as remaining', async () => {
		const lines = await frame_after({ closed: new Map(), is_whole: true })

		expect(row_of(lines)).toContain(`🙋 ${String(ISSUE)}`)
		expect(lines[0]).toContain('⏳ 1  💤 0')
	})
})

// joshuafolkken/kit#4127: the findings section read the park off the stream and kept saying it after
// the child closed.
describe('run_board_tick.tick — the findings line of a park', () => {
	// A findings line leads with the park's clock time, which a row does not.
	const FINDING = new RegExp(String.raw`💤 \d{2}:\d{2} ${String(ISSUE)} `, 'u')

	it('leaves out the park of a child closed after it', async () => {
		const local = local_parked('waiting on #4085')
		const lines = await frame_after(answer_of({ is_not_planned: true }), local)

		expect(lines.join('\n')).not.toContain('(waiting on #4085)')
		expect(lines.some((line) => FINDING.test(line))).toBe(false)
	})

	it('keeps the park of a child still parked whose row draws no reason', async () => {
		const lines = await frame_after({ closed: new Map(), is_whole: true }, local_parked('parked'))

		expect(lines.some((line) => FINDING.test(line))).toBe(true)
	})
})
