import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship } from './run-ship'
import { run_ship_reship } from './run-ship-reship'

const make_directory = temporary_directory()

// joshuafolkken/kit#6141: a re-ship after a review failure passes over the pre-detach region only
// while the last stop of the issue was that failure, on the base the tree stands on now.

const ISSUE = 6141
const REVIEW = 'review'
const PRE_DETACH = 'pre-detach'
const BASE = 'a'.repeat(40)
const MOVED = 'b'.repeat(40)
const AT = '2026-11-03T00:00:00.000Z'

// A stop, unless `kind` names another ledger row.
interface Stop {
	kind?: string
	issue?: number
	reason?: string
	cause?: string
	preconditions?: Array<string>
	base?: string
	stage?: string
	elapsed_ms?: number
}

const REVIEW_CHECK: Stop = { reason: 'review', cause: 'check', base: BASE }

function stage_mark(stage: string): Stop {
	return { kind: 'stage', stage, elapsed_ms: 9 }
}

function ledger_of(stops: ReadonlyArray<Stop>): string {
	const directory = make_directory('josh-reship-')
	const lines = stops.map((stop) => JSON.stringify({ kind: 'stop', at: AT, issue: ISSUE, ...stop }))

	const ledger = path.join(directory, 'ledger.jsonl')

	writeFileSync(ledger, `${lines.join('\n')}\n`)

	return ledger
}

async function is_due_after(stops: ReadonlyArray<Stop>): Promise<boolean> {
	return await run_ship_reship.is_due(String(ISSUE), ledger_of(stops))
}

beforeEach(() => {
	vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(BASE)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_reship.is_due', () => {
	it.each([
		['a review check', REVIEW_CHECK],
		['a review finding', { reason: 'review', cause: 'finding', base: BASE }],
		['a round-2 finding', { reason: 'round-2', cause: 'finding', base: BASE }],
		['a followup check', { reason: 'followup', cause: 'check', base: BASE }],
	])('passes over the pre-detach region after %s on an unmoved base', async (_name, stop) => {
		expect(await is_due_after([{ reason: 'preflight' }, stop])).toBe(true)
	})

	it.each([
		['an unplanned preflight stop', { reason: 'preflight', preconditions: ['unplanned'] }],
		[
			'an unpinned preflight stop',
			{ reason: 'preflight', preconditions: [PRE_DETACH, 'unpinned'] },
		],
		['a failed preflight', { reason: 'preflight', cause: 'check' }],
		['a red gate', { reason: 'gate', cause: 'check' }],
		['a review the reviewer never finished', { reason: 'review', cause: 'infra', base: BASE }],
		['a followup that hit an outage', { reason: 'followup', cause: 'infra', base: BASE }],
		['a followup conflict', { reason: 'followup', cause: 'conflict', base: BASE }],
	])('runs it all after %s that followed a review failure', async (_name, stop) => {
		expect(await is_due_after([REVIEW_CHECK, stop])).toBe(false)
	})

	it('runs it all once the base moved since the review failure', async () => {
		vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(MOVED)

		expect(await is_due_after([REVIEW_CHECK])).toBe(false)
	})

	it('runs it all after a review failure recorded with no base, or another issue’s', async () => {
		expect(await is_due_after([{ reason: 'review', cause: 'check' }])).toBe(false)
		expect(await is_due_after([{ ...REVIEW_CHECK, issue: ISSUE + 1 }])).toBe(false)
	})

	it('runs it all with no ledger to read, as under a test run', async () => {
		expect(await run_ship_reship.is_due(String(ISSUE))).toBe(false)
	})
})

describe('run_ship_reship.is_due — a ship stage after the review failure', () => {
	it.each(['preflight', REVIEW, PRE_DETACH])(
		'runs it all once a %s stage ran after it',
		async (stage) => {
			expect(await is_due_after([REVIEW_CHECK, stage_mark(stage)])).toBe(false)
		},
	)

	it('passes over it still when only another issue’s stage or a non-ship one followed', async () => {
		const elsewhere = { ...stage_mark(REVIEW), issue: ISSUE + 1 }

		expect(await is_due_after([REVIEW_CHECK, elsewhere, stage_mark('implementation')])).toBe(true)
	})
})

describe('run_ship_reship.with_base', () => {
	it('records the base on a review failure or a followup check only', async () => {
		const review = { issue: ISSUE, reason: 'review', cause: 'finding' }
		const followup = { issue: ISSUE, reason: 'followup', cause: 'check' }
		const gate = { issue: ISSUE, reason: 'gate', cause: 'check' }

		expect(await run_ship_reship.with_base(review)).toStrictEqual({ ...review, base: BASE })
		expect(await run_ship_reship.with_base(followup)).toStrictEqual({ ...followup, base: BASE })
		expect(await run_ship_reship.with_base(gate)).toStrictEqual(gate)
	})

	it('leaves the base out where it cannot be read', async () => {
		vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(undefined)
		const review = { issue: ISSUE, reason: 'review', cause: 'check' }

		expect(await run_ship_reship.with_base(review)).toStrictEqual(review)
	})
})

describe('run_ship_reship.skipped', () => {
	it('prints the skip, marks it on the event stream and reports it as the preflight', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue()
		const emit = vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()

		const section = await run_ship_reship.skipped(String(ISSUE))

		expect(error).toHaveBeenCalledWith(
			'pre-detach: skipped (re-ship after review or followup failure)',
		)
		expect(emit).toHaveBeenCalledWith(
			'ship-stage',
			expect.stringMatching(/pre-detach skipped .*re-ship after review or followup failure$/u),
		)
		expect(section).toStrictEqual({
			header: run_ship.PREFLIGHT_HEADER,
			body: run_ship_reship.SKIP_NOTE,
			code: 0,
		})
	})
})
