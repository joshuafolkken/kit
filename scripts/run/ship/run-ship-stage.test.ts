import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_ship_stage, type ShipState } from './run-ship-stage'

// joshuafolkken/kit#2426: which stage a resumed ship may pass over, decided from the record and the
// repository's actual state, and the record's own read/write round trip.

const { STAGE } = run_ship_stage
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-stage-'))
const NOTHING: ShipState = { is_committed: false, is_pushed: false, is_merged: false }
const COMMITTED: ShipState = { ...NOTHING, is_committed: true }
const SHIPPED: ShipState = { ...COMMITTED, is_pushed: true }
const MERGED: ShipState = { ...SHIPPED, is_merged: true }
const NONE: ReadonlySet<string> = new Set()
const ALL: ReadonlySet<string> = new Set(Object.values(STAGE))
const REPOSITORY = '/repo/.git'
const SKIP_COMMIT = '--skip-commit'

function fresh_target(): string {
	return path.join(TEMPORARY, `${randomUUID()}.json`)
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_ship_stage.is_done — the gate', () => {
	it('runs on a fresh tree even when the record says it completed', () => {
		expect(run_ship_stage.is_done(STAGE.GATE, ALL, NOTHING)).toBe(false)
	})

	it('is passed over once its output, a pushed commit, exists', () => {
		expect(run_ship_stage.is_done(STAGE.GATE, NONE, SHIPPED)).toBe(true)
	})

	// joshuafolkken/kit#4708: the sync stage's local commit precedes the gate, so it is not its output.
	it('runs again over a commit not yet pushed', () => {
		expect(run_ship_stage.is_done(STAGE.GATE, ALL, COMMITTED)).toBe(false)
		expect(run_ship_stage.is_done(STAGE.SYNC, ALL, COMMITTED)).toBe(false)
	})

	it('is passed over once the pull request merged', () => {
		expect(run_ship_stage.is_done(STAGE.GATE, NONE, MERGED)).toBe(true)
	})
})

// joshuafolkken/kit#2946: the preflight asks what the commit stage would refuse on.
describe('run_ship_stage.is_done — the preflight', () => {
	it('runs on a fresh tree whatever the record says', () => {
		expect(run_ship_stage.is_done(STAGE.PREFLIGHT, ALL, NOTHING)).toBe(false)
	})

	it('is passed over once a commit exists', () => {
		expect(run_ship_stage.is_done(STAGE.PREFLIGHT, NONE, COMMITTED)).toBe(true)
	})
})

describe('run_ship_stage.is_done — the commit/push/PR stage', () => {
	it('runs with no record even when committed and pushed, so the pull request is still ensured', () => {
		expect(run_ship_stage.is_done(STAGE.COMMIT, NONE, SHIPPED)).toBe(false)
	})

	it('honors the record while the state still corroborates it', () => {
		expect(run_ship_stage.is_done(STAGE.COMMIT, ALL, SHIPPED)).toBe(true)
	})

	it('overrules a stale record once new work sits uncommitted', () => {
		expect(run_ship_stage.is_done(STAGE.COMMIT, ALL, NOTHING)).toBe(false)
	})

	it('is passed over once merged, record or not', () => {
		expect(run_ship_stage.is_done(STAGE.COMMIT, NONE, MERGED)).toBe(true)
	})

	// joshuafolkken/kit#2446: the evidence body a refused followup asked for reaches the open PR only
	// through `git -y`, so a rerun carrying one reruns this stage.
	it('reruns a recorded stage when a PR body is supplied', () => {
		expect(run_ship_stage.is_done(STAGE.COMMIT, ALL, SHIPPED, true)).toBe(false)
		expect(run_ship_stage.is_done(STAGE.GATE, ALL, SHIPPED, true)).toBe(true)
	})

	it('still passes over a merged stage when a PR body is supplied', () => {
		expect(run_ship_stage.is_done(STAGE.COMMIT, ALL, MERGED, true)).toBe(true)
	})
})

describe('run_ship_stage.is_done — followup and report', () => {
	it('never merges twice: followup is passed over for a merged pull request with no record', () => {
		expect(run_ship_stage.is_done(STAGE.FOLLOWUP, NONE, MERGED)).toBe(true)
	})

	it('passes over a recorded followup', () => {
		expect(run_ship_stage.is_done(STAGE.FOLLOWUP, new Set([STAGE.FOLLOWUP]), SHIPPED)).toBe(true)
	})

	it('runs followup when a stale record is not corroborated by a shipped state', () => {
		expect(run_ship_stage.is_done(STAGE.FOLLOWUP, new Set([STAGE.FOLLOWUP]), NOTHING)).toBe(false)
	})

	it('runs followup for an unmerged, unrecorded pull request', () => {
		expect(run_ship_stage.is_done(STAGE.FOLLOWUP, NONE, SHIPPED)).toBe(false)
	})

	it('runs the report after a merge unless it is recorded', () => {
		expect(run_ship_stage.is_done(STAGE.REPORT, NONE, MERGED)).toBe(false)
		expect(run_ship_stage.is_done(STAGE.REPORT, new Set([STAGE.REPORT]), MERGED)).toBe(true)
	})
})

// joshuafolkken/kit#2489: the round-2 pass reads the pushed fix delta, so a resumed ship repeats it
// unless its record still stands on that push.
describe('run_ship_stage.is_done — the round-2 pass', () => {
	it('runs with no record on a shipped tree', () => {
		expect(run_ship_stage.is_done(STAGE.ROUND_TWO, NONE, SHIPPED)).toBe(false)
	})

	it('passes over a recorded pass while the push still stands', () => {
		expect(run_ship_stage.is_done(STAGE.ROUND_TWO, new Set([STAGE.ROUND_TWO]), SHIPPED)).toBe(true)
	})

	it('reruns a recorded pass once the state no longer corroborates it', () => {
		expect(run_ship_stage.is_done(STAGE.ROUND_TWO, new Set([STAGE.ROUND_TWO]), NOTHING)).toBe(false)
	})

	it('is passed over once merged', () => {
		expect(run_ship_stage.is_done(STAGE.ROUND_TWO, NONE, MERGED)).toBe(true)
	})
})

describe('run_ship_stage.commit_flags — never a second commit or push', () => {
	it('passes no flag for uncommitted work', () => {
		expect(run_ship_stage.commit_flags(NOTHING)).toStrictEqual([])
	})

	it('skips the commit alone when the commit is not on origin yet', () => {
		expect(run_ship_stage.commit_flags(COMMITTED)).toStrictEqual([SKIP_COMMIT])
	})

	it('skips the commit and the push when origin already holds the commit', () => {
		expect(run_ship_stage.commit_flags(SHIPPED)).toStrictEqual([SKIP_COMMIT, '--skip-push'])
	})

	it('never skips the push beneath a commit still to be made', () => {
		expect(run_ship_stage.commit_flags({ ...NOTHING, is_pushed: true })).toStrictEqual([])
	})
})

describe('run_ship_stage record — read, mark and clear', () => {
	it('reads an absent record as nothing done', () => {
		expect(run_ship_stage.read_done(fresh_target()).size).toBe(0)
	})

	it('reads a malformed record as nothing done', () => {
		const target = fresh_target()

		writeFileSync(target, 'not json')

		expect(run_ship_stage.read_done(target).size).toBe(0)
	})

	it('accumulates marked stages and keeps each once', () => {
		const target = fresh_target()

		run_ship_stage.mark_done(target, STAGE.GATE)
		run_ship_stage.mark_done(target, STAGE.COMMIT)
		run_ship_stage.mark_done(target, STAGE.COMMIT)

		expect([...run_ship_stage.read_done(target)]).toStrictEqual([STAGE.GATE, STAGE.COMMIT])
	})

	it('clears the record so a later ship starts from the gate', () => {
		const target = fresh_target()

		run_ship_stage.mark_done(target, STAGE.GATE)
		run_ship_stage.clear(target)

		expect(run_ship_stage.read_done(target).size).toBe(0)
	})

	it('keys the record on the issue as well as the repository', () => {
		const one = run_ship_stage.record_path(REPOSITORY, '7')

		expect(run_ship_stage.record_path(REPOSITORY, '8')).not.toBe(one)
	})

	it('writes the stage and phase into the event text', () => {
		expect(run_ship_stage.event_text('7', STAGE.GATE, run_ship_stage.PHASE.FAILED)).toBe(
			'#7 gate failed',
		)
	})
})

describe('run_ship_stage record — the attempt’s started stages (joshuafolkken/kit#3552)', () => {
	it('keeps the started stages beside the done ones until the attempt ends', () => {
		const target = fresh_target()

		run_ship_stage.mark_started(target, STAGE.GATE)
		run_ship_stage.mark_done(target, STAGE.GATE)
		run_ship_stage.mark_started(target, STAGE.GATE)
		run_ship_stage.mark_started(target, STAGE.COMMIT)

		expect(run_ship_stage.read_started(target)).toStrictEqual([STAGE.GATE, STAGE.COMMIT])

		run_ship_stage.end_attempt(target)

		expect(run_ship_stage.read_started(target)).toStrictEqual([])
		expect([...run_ship_stage.read_done(target)]).toStrictEqual([STAGE.GATE])
	})

	it('reads a record written before the field as no stage started', () => {
		const target = fresh_target()

		writeFileSync(target, JSON.stringify({ done: [STAGE.GATE] }))

		expect(run_ship_stage.read_started(target)).toStrictEqual([])
		expect([...run_ship_stage.read_done(target)]).toStrictEqual([STAGE.GATE])
	})
})

describe('run_ship_stage record — the merge wait (joshuafolkken/kit#4466)', () => {
	it('keeps the merge wait beside the started stages until it is taken down', () => {
		const target = fresh_target()

		run_ship_stage.mark_started(target, STAGE.FOLLOWUP)
		run_ship_stage.mark_merge_waiting(target, true)

		expect(run_ship_stage.read_merge_waiting(target)).toBe(true)
		expect(run_ship_stage.read_started(target)).toStrictEqual([STAGE.FOLLOWUP])

		run_ship_stage.mark_merge_waiting(target, false)

		expect(run_ship_stage.read_merge_waiting(target)).toBe(false)
	})

	it('takes the merge wait down when a stop ends the attempt', () => {
		const target = fresh_target()

		run_ship_stage.mark_merge_waiting(target, true)
		run_ship_stage.end_attempt(target)

		expect(run_ship_stage.read_merge_waiting(target)).toBe(false)
	})

	it('reads a record written before the field as not waiting', () => {
		const target = fresh_target()

		writeFileSync(target, JSON.stringify({ done: [], started: [STAGE.FOLLOWUP] }))

		expect(run_ship_stage.read_merge_waiting(target)).toBe(false)
		expect(run_ship_stage.read_place_waiting(target)).toBe(false)
	})
})

describe('run_ship_stage record — the place wait (joshuafolkken/kit#4466)', () => {
	it('keeps the place wait apart from the merge wait until it is taken down', () => {
		const target = fresh_target()

		run_ship_stage.mark_place_waiting(target, true)

		expect(run_ship_stage.read_place_waiting(target)).toBe(true)
		expect(run_ship_stage.read_merge_waiting(target)).toBe(false)

		run_ship_stage.mark_place_waiting(target, false)

		expect(run_ship_stage.read_place_waiting(target)).toBe(false)
	})

	it('takes both waits down for a successor supervisor and keeps the stages', () => {
		const target = fresh_target()

		run_ship_stage.mark_done(target, STAGE.COMMIT)
		run_ship_stage.mark_merge_waiting(target, true)
		run_ship_stage.mark_place_waiting(target, true)
		run_ship_stage.clear_waits(target)

		expect(run_ship_stage.read_merge_waiting(target)).toBe(false)
		expect(run_ship_stage.read_place_waiting(target)).toBe(false)
		expect(run_ship_stage.read_done(target).has(STAGE.COMMIT)).toBe(true)
	})
})

describe('run_ship_stage.started_of — the attempt a line carries (joshuafolkken/kit#3552)', () => {
	const { PHASE } = run_ship_stage

	it('round-trips the stages written as the fourth word', () => {
		const text = run_ship_stage.event_text('7', STAGE.GATE, PHASE.START, [
			STAGE.PREFLIGHT,
			STAGE.REVIEW,
			STAGE.GATE,
		])

		expect(text).toBe('#7 gate start preflight,review,gate')
		expect(run_ship_stage.started_of(text)).toStrictEqual(['preflight', 'review', 'gate'])
	})

	it('reads no attempt off a three-word line', () => {
		expect(run_ship_stage.started_of('#7 gate start')).toBeUndefined()
	})
})

describe('run_ship_stage.is_done — the --review round (joshuafolkken/kit#2427)', () => {
	it('runs on a fresh tree with no record', () => {
		expect(run_ship_stage.is_done(STAGE.REVIEW, NONE, NOTHING)).toBe(false)
	})

	it('runs again before a commit even when recorded, since the tree may have changed', () => {
		expect(run_ship_stage.is_done(STAGE.REVIEW, new Set([STAGE.REVIEW]), NOTHING)).toBe(false)
	})

	it('is passed over once a pushed commit or a merge exists, never on a commit alone', () => {
		expect(run_ship_stage.is_done(STAGE.REVIEW, NONE, SHIPPED)).toBe(true)
		expect(run_ship_stage.is_done(STAGE.REVIEW, NONE, MERGED)).toBe(true)
		expect(run_ship_stage.is_done(STAGE.REVIEW, ALL, COMMITTED)).toBe(false)
	})

	it('runs again on a committed tree once the issue changed after its brief (joshuafolkken/kit#4221)', () => {
		const stale = { ...COMMITTED, is_review_stale: true }

		expect(run_ship_stage.is_done(STAGE.REVIEW, new Set([STAGE.REVIEW]), stale)).toBe(false)
		expect(run_ship_stage.is_done(STAGE.REVIEW, NONE, { ...MERGED, is_review_stale: true })).toBe(
			true,
		)
	})
})
