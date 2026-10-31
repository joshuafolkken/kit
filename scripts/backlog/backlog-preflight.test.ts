import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_preflight } from './backlog-preflight'
import { backlogrun_launch } from './backlogrun-launch'

// joshuafolkken/kit#5516: `josh backlogrun` begins and hands off the carry record itself, so the
// supervisor drives the first offer while the parent plans, and the launched parent takes nothing.

const scratch = mkdtempSync(path.join(tmpdir(), 'backlog-preflight-test-'))
const GIT_DIRECTORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const LAUNCHED_AT = '2026-10-31T11:49:16.000Z'
const PARENT_PID = 4242
const SUPERVISOR_PID = 4343
const WOKEN_PID = 5151
const REQUEST = {
	git_directory: GIT_DIRECTORY,
	invocation: INVOCATION,
	provider: 'anthropic',
} as const

function target(): string {
	return run_carry.carry_path(GIT_DIRECTORY)
}

function carried(): RunCarry | undefined {
	const read = run_carry.read_carry(target())

	return read.kind === 'carried' ? read.carry : undefined
}

function launched(): void {
	vi.spyOn(backlogrun_launch, 'pending_launch').mockReturnValue({
		invocation: INVOCATION,
		started_at: LAUNCHED_AT,
	})
}

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(target(), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('backlog_preflight.preflight', () => {
	it('begins the record for the invocation and hands it off at once', () => {
		launched()

		expect(backlog_preflight.preflight(REQUEST).kind).toBe('handed-off')
		expect(carried()).toMatchObject({
			invocation: INVOCATION,
			is_handed_off: true,
			owner_pid: process.pid,
			scheduler_provider: 'anthropic',
		})
		expect(carried()).not.toHaveProperty('owner_transcript')
	})

	it('starts the run at the launch, the moment the board already counts from', () => {
		launched()

		backlog_preflight.preflight(REQUEST)

		expect(carried()?.started_at).toBe(LAUNCHED_AT)
	})

	it('leaves a record already standing as it is', () => {
		const standing = run_carry.begin_carry(target(), INVOCATION)

		expect(backlog_preflight.preflight(REQUEST)).toStrictEqual({ kind: 'standing' })
		expect(carried()).toEqual(standing)
	})
})

describe('backlog_preflight.is_driven_for', () => {
	const supervised: RunCarry = {
		...run_carry.fresh_carry(INVOCATION, {}, new Date()),
		owner_pid: SUPERVISOR_PID,
	}

	function driven(parent: number | undefined, asking: number | undefined): boolean {
		vi.spyOn(backlogrun_launch, 'running_parent').mockReturnValue(parent)

		return backlog_preflight.is_driven_for(GIT_DIRECTORY, supervised, { pid: asking })
	}

	it('answers the launched parent over a record another process holds', () => {
		expect(driven(PARENT_PID, PARENT_PID)).toBe(true)
	})

	it('never answers a session the driver woke, which still resumes the record', () => {
		expect(driven(PARENT_PID, WOKEN_PID)).toBe(false)
	})

	it('never answers with no launch standing, as for a run typed in a session', () => {
		expect(driven(undefined, undefined)).toBe(false)
	})

	it('never answers the parent over a record it owns itself', () => {
		expect(driven(SUPERVISOR_PID, SUPERVISOR_PID)).toBe(false)
	})
})
