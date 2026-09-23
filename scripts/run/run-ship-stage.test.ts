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

	it('is passed over once its output, a commit, exists', () => {
		expect(run_ship_stage.is_done(STAGE.GATE, NONE, COMMITTED)).toBe(true)
	})

	it('is passed over once the pull request merged', () => {
		expect(run_ship_stage.is_done(STAGE.GATE, NONE, MERGED)).toBe(true)
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

describe('run_ship_stage.is_done — the --review round (joshuafolkken/kit#2427)', () => {
	it('runs on a fresh tree with no record', () => {
		expect(run_ship_stage.is_done(STAGE.REVIEW, NONE, NOTHING)).toBe(false)
	})

	it('runs again before a commit even when recorded, since the tree may have changed', () => {
		expect(run_ship_stage.is_done(STAGE.REVIEW, new Set([STAGE.REVIEW]), NOTHING)).toBe(false)
	})

	it('is passed over once a commit or a merge exists', () => {
		expect(run_ship_stage.is_done(STAGE.REVIEW, NONE, COMMITTED)).toBe(true)
		expect(run_ship_stage.is_done(STAGE.REVIEW, NONE, MERGED)).toBe(true)
	})
})
