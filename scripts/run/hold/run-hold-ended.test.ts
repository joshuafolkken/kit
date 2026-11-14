import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_hold, type HoldRead, type RunHold } from './run-hold'
import { run_hold_ended } from './run-hold-ended'

// joshuafolkken/kit#7525: the hold a merge releases is kept, so `run:board` can list the run in done.

const TAKEN_AT = '2026-11-14T10:00:00.000Z'
const ENDED = new Date('2026-11-14T10:30:00.000Z')
const PID = 4242
const create_directory = temporary_directory()

function held(issue: string, is_fullrun?: boolean): HoldRead {
	const hold: RunHold = { issue, taken_at: TAKEN_AT, pid: PID, is_fullrun }

	return { kind: 'held', hold }
}

function target_of(): string {
	return path.join(create_directory('run-hold-ended-'), 'ended.json')
}

describe('run_hold_ended', () => {
	it('records a released hold’s issue, start and end, a fullrun marked', () => {
		const target = target_of()

		run_hold_ended.record_ended(target, held('7521', true), ENDED)
		run_hold_ended.record_ended(target, held('7522'), ENDED)

		expect(run_hold_ended.read_ended(target)).toStrictEqual([
			{ issue: '7521', is_fullrun: true, taken_at: TAKEN_AT, ended_at: ENDED.toISOString() },
			{ issue: '7522', taken_at: TAKEN_AT, ended_at: ENDED.toISOString() },
		])
	})

	it.each<HoldRead>([{ kind: 'free' }, { kind: 'unreadable' }])(
		'records nothing for a %o read',
		(read) => {
			const target = target_of()

			run_hold_ended.record_ended(target, read, ENDED)

			expect(run_hold_ended.read_ended(target)).toStrictEqual([])
		},
	)

	it('keeps only the newest runs', () => {
		const target = target_of()
		const issues = Array.from({ length: run_hold_ended.KEPT_RUNS + 1 }, (_, index) => String(index))

		for (const issue of issues) run_hold_ended.record_ended(target, held(issue), ENDED)

		const kept = run_hold_ended.read_ended(target).map((ended) => ended.issue)

		expect(kept).toStrictEqual(issues.slice(1))
	})

	it('reads nothing from a record that does not parse', () => {
		const target = target_of()

		writeFileSync(target, '{"issue":')

		expect(run_hold_ended.read_ended(target)).toStrictEqual([])
	})

	it('keys the record apart from the hold on the same git directory', () => {
		const git_directory = '/scratch/.git'

		expect(run_hold_ended.ended_path(git_directory)).not.toBe(run_hold.hold_path(git_directory))
	})
})
