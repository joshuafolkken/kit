import { mkdtempSync, readFileSync } from 'node:fs'
import { getPriority, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { detached_launch, type LaunchArgv } from './detached-launch'
import { launch_priority } from './launch-priority'

const PID = 4242
const DETACHED_TIMEOUT_MS = 5000

// The child forks its own child only after the launch returns, as an agent CLI does once it has
// booted, and that descendant prints its own niceness into the launch log.
const DESCENDANT_NICENESS: LaunchArgv = {
	command: 'sh',
	args: ['-c', "sleep 0.2; sh -c 'ps -o nice= -p $$'"],
}

function refuse(): void {
	throw new Error('EACCES')
}

function ignore_error(_note: string): void {
	/* the niceness read below fails the test on a launch that did not run */
}

function launch_log_path(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'launch-priority-'))

	return path.join(directory, 'launch.log')
}

function logged_niceness(log_path: string): number {
	const lines = readFileSync(log_path, 'utf8').trim().split('\n')

	return Number(lines.at(-1))
}

async function descendant_niceness(): Promise<number> {
	const log_path = launch_log_path()

	await detached_launch.launch_attached(
		{ argv: DESCENDANT_NICENESS, cwd: process.cwd(), log_path },
		ignore_error,
	)

	return logged_niceness(log_path)
}

describe('launch_priority.lower', () => {
	it('lowers the launched child to the lane niceness', () => {
		const set_priority = vi.fn()

		launch_priority.lower(PID, set_priority)

		expect(set_priority).toHaveBeenCalledWith(PID, launch_priority.LANE_NICENESS)
	})

	it('runs lanes below the default priority', () => {
		expect(launch_priority.LANE_NICENESS).toBeGreaterThan(0)
	})

	it('does nothing for a child that started without a pid', () => {
		const set_priority = vi.fn()

		launch_priority.lower(undefined, set_priority)

		expect(set_priority).not.toHaveBeenCalled()
	})

	it('starts the session as before when the priority cannot be lowered', () => {
		expect(() => {
			launch_priority.lower(PID, refuse)
		}).not.toThrow()
	})
})

describe('the launched priority', () => {
	it('runs a launched session and its descendants at the lane niceness', async () => {
		const expected = Math.max(getPriority(), launch_priority.LANE_NICENESS)

		expect(await descendant_niceness()).toBe(expected)
	})

	it('runs a detached session and its descendants at the lane niceness', async () => {
		const expected = Math.max(getPriority(), launch_priority.LANE_NICENESS)
		const log_path = launch_log_path()

		detached_launch.launch(
			{ argv: DESCENDANT_NICENESS, cwd: process.cwd(), log_path },
			ignore_error,
		)

		await vi.waitFor(
			() => {
				expect(logged_niceness(log_path)).toBe(expected)
			},
			{ timeout: DETACHED_TIMEOUT_MS },
		)
	})
})
