import type { EpicChild } from '#scripts/epic/epic-graph'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'
import { run_resume_wait } from './run-resume-wait'

const { EVENT_KIND } = run_event_stream
const AT = '2026-11-23T06:32:50Z'
const REPO = 'joshuafolkken/kit'
const OUTAGE_ISSUE = '8757'
const OTHER_ISSUE = '8787'
const OUTAGE_REF = '#8757'
const OTHER_REF = '#8787'
const BLOCKER_REF = '#8770'

function event(kind: string, text: string): RunEvent {
	return { pos: 0, at: AT, kind, text }
}

function child(blockers: ReadonlyArray<EpicChild['blocked_by'][number]>): EpicChild {
	return {
		number: Number(OUTAGE_ISSUE),
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blockers,
	}
}

const { BLOCKER_WAIT, SEAT_WAIT, awaiting, reason_of, record } = run_resume_wait

describe('run_resume_wait.awaiting', () => {
	it('reads no wait from an empty stream', () => {
		expect(awaiting([])).toStrictEqual(new Map())
	})

	it('opens a wait at an outage and keeps the newest reason recorded for it', () => {
		const waits = awaiting([
			event(EVENT_KIND.OUTAGE, `${OUTAGE_REF} outage`),
			event(EVENT_KIND.RESUME_WAIT, `${OUTAGE_REF} ${SEAT_WAIT}`),
			event(EVENT_KIND.RESUME_WAIT, `${OUTAGE_REF} ${BLOCKER_WAIT} ${BLOCKER_REF}`),
			event(EVENT_KIND.OUTAGE, `${OTHER_REF} outage`),
		])

		expect(waits).toStrictEqual(
			new Map([
				[OUTAGE_ISSUE, `${BLOCKER_WAIT} ${BLOCKER_REF}`],
				[OTHER_ISSUE, undefined],
			]),
		)
	})

	it('ends the wait at a launch, and opens it again at a later outage', () => {
		const outage = event(EVENT_KIND.OUTAGE, `${OUTAGE_REF} outage`)
		const launched = [outage, event(EVENT_KIND.CHILD_LAUNCH, `${OUTAGE_REF} launched`)]
		const again = awaiting([...launched, outage])

		expect(awaiting(launched).has(OUTAGE_ISSUE)).toBe(false)
		expect(again.has(OUTAGE_ISSUE)).toBe(true)
		expect(again.get(OUTAGE_ISSUE)).toBeUndefined()
	})

	it('ignores a reason for an issue no outage stopped, and a line naming no issue', () => {
		const waits = awaiting([
			event(EVENT_KIND.RESUME_WAIT, `${OTHER_REF} ${SEAT_WAIT}`),
			event(EVENT_KIND.OUTAGE, 'no issue here'),
		])

		expect(waits.size).toBe(0)
	})
})

describe('run_resume_wait.reason_of', () => {
	it.each([
		['no blocker', [], SEAT_WAIT],
		['a local blocker', [{ repo: REPO, number: 8770 }], `${BLOCKER_WAIT} ${BLOCKER_REF}`],
		[
			'blockers in two repositories',
			[
				{ repo: REPO, number: 8770 },
				{ repo: 'someone/other', number: 12 },
			],
			`${BLOCKER_WAIT} ${BLOCKER_REF} someone/other#12`,
		],
	])('names the wait of a child with %s', (_label, blockers, expected) => {
		expect(reason_of(child(blockers))).toBe(expected)
	})
})

describe('run_resume_wait.record', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	})

	it('writes a changed reason for an awaiting issue', async () => {
		await record(new Map([[OUTAGE_ISSUE, undefined]]), OUTAGE_ISSUE, SEAT_WAIT)

		expect(run_event_stream_emit.emit).toHaveBeenCalledWith(
			EVENT_KIND.RESUME_WAIT,
			`${OUTAGE_REF} ${SEAT_WAIT}`,
		)
	})

	it.each([
		['the same reason again', new Map([[OUTAGE_ISSUE, SEAT_WAIT]])],
		['an issue no outage stopped', new Map<string, string | undefined>()],
	])('writes nothing for %s', async (_label, waits) => {
		await record(waits, OUTAGE_ISSUE, SEAT_WAIT)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})
