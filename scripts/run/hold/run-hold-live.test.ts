import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_hold, type RunHold } from './run-hold'
import { run_hold_live } from './run-hold-live'

// joshuafolkken/kit#8922: a run in the root checkout is read by its live hold — the phase and usage of
// its row — while a person's own session, a gone session and a stopped run are not.

const ISSUE = '8922'
// `held_by` reads the hold at the clock's own now, so the hold is taken at it.
const NOW = new Date()
const RUNNER_PID = 4242
const GONE_PID = 99_999_999
const OTHER_PID = 7
const create_directory = temporary_directory()

function own_owner(): Partial<RunHold> {
	return { owner_pid: process.pid, owner_start: process_identity.read_start(process.pid) }
}

function write_hold(git: string, mark: Partial<RunHold> | undefined): void {
	if (mark === undefined) return

	const hold: RunHold = { issue: ISSUE, taken_at: NOW.toISOString(), pid: RUNNER_PID, ...mark }

	writeFileSync(run_hold.hold_path(git), JSON.stringify(hold))
}

function checkout_with(mark?: Partial<RunHold>): string {
	const directory = create_directory('run-hold-live-')
	const git = path.join(directory, '.git')

	mkdirSync(git)
	write_hold(git, mark)

	return directory
}

describe('run_hold_live.live_hold', () => {
	it('answers the issue and owner of a hold whose session is running', () => {
		const directory = checkout_with(own_owner())

		expect(run_hold_live.live_hold(directory, NOW)).toStrictEqual({
			issue: ISSUE,
			pid: process.pid,
		})
	})

	it.each<[string, Partial<RunHold> | undefined]>([
		['no hold', undefined],
		['a hold whose session has ended', { owner_pid: GONE_PID }],
		['a hold with no owner recorded', {}],
		['a stop-marked hold', { ...own_owner(), is_halfrun_stop: true }],
		['a hold naming no issue number', { ...own_owner(), issue: 'chore' }],
	])('answers nothing for %s', (_name, mark) => {
		expect(run_hold_live.live_hold(checkout_with(mark), NOW)).toBeUndefined()
	})

	it('answers nothing outside a git checkout', () => {
		expect(run_hold_live.live_hold(create_directory('run-hold-live-bare-'), NOW)).toBeUndefined()
	})
})

describe('run_hold_live.held_by', () => {
	it('answers the issue for a process under the hold’s session', () => {
		const directory = checkout_with(own_owner())

		expect(run_hold_live.held_by(directory, () => new Set([OTHER_PID, process.pid]))).toBe(ISSUE)
	})

	it('answers nothing for a session the hold’s owner is not above', () => {
		const directory = checkout_with(own_owner())

		expect(run_hold_live.held_by(directory, () => new Set([OTHER_PID]))).toBeUndefined()
	})

	it('never walks the ancestry where no hold is live', () => {
		let walked = false

		run_hold_live.held_by(checkout_with(), () => {
			walked = true

			return new Set()
		})

		expect(walked).toBe(false)
	})
})
