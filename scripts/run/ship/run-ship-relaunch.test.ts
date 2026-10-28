import { randomUUID } from 'node:crypto'
import { stamp_file } from '#scripts/josh/stamp-file'
import type { detached_launch, LaunchRequest } from '#scripts/run/detached-launch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_relaunch } from './run-ship-relaunch'

const launch_mock = vi.hoisted(() => vi.fn<typeof detached_launch.launch>())

vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch: launch_mock } }))

// joshuafolkken/kit#4849: a supervisor's successor on new code is the same launch, and the record
// keeps naming this supervisor until the successor claims it.

const TITLE = 'Hand a ship to a supervisor on the new code #4849'
const NUMBER = '4849'
const LAUNCH_ID = 'launch-4849'
const OWN_PID = 1111
const OWN_START = 'Sun Oct 25 07:00:00 2026'
const SUCCESSOR_PID = 2222
const SUCCESSOR_START = 'Sun Oct 25 07:05:00 2026'
const scratch = { repository: '' }

function request(): Parameters<typeof run_ship_relaunch.relaunch>[0] {
	return { repository: scratch.repository, number: NUMBER, cwd: '/tmp' }
}

function write_record(pid: number, process_start: string): void {
	stamp_file.replace_stamp(run_ship_detach.result_path(scratch.repository, NUMBER), {
		launch_id: LAUNCH_ID,
		pid,
		process_start,
		launched_at: 1,
	})
}

function launched(): LaunchRequest | undefined {
	return launch_mock.mock.calls[0]?.[0]
}

function holder(): number | undefined {
	return run_ship_relaunch.holder_pid(scratch.repository, NUMBER)
}

beforeEach(() => {
	scratch.repository = `/tmp/josh-ship-relaunch-test-${randomUUID()}`
	vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, LAUNCH_ID)
	launch_mock.mockReset().mockReturnValue({ kind: 'launched', pid: SUCCESSOR_PID })
	write_record(OWN_PID, OWN_START)
})

afterEach(() => {
	stamp_file.remove_stamp(run_ship_detach.result_path(scratch.repository, NUMBER))
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('run_ship_relaunch.relaunch', () => {
	it('re-invokes this process under the same runner and launch id, so the pid it starts is the one that claims', () => {
		vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'josh.ts', 'ship', '--review', TITLE])

		expect(run_ship_relaunch.relaunch(request())).toBe(SUCCESSOR_PID)

		const launch = launched()

		expect(launch?.argv.command).toBe(process.execPath)
		expect(launch?.argv.args).toStrictEqual([
			...process.execArgv,
			'josh.ts',
			'ship',
			'--review',
			TITLE,
		])
		expect(launch?.env).toMatchObject({
			[run_ship_detach.LAUNCH_ID_KEY]: LAUNCH_ID,
			[run_ship_detach.SUPERVISED_KEY]: '1',
		})
	})

	it('leaves the record naming this supervisor', () => {
		run_ship_relaunch.relaunch(request())

		expect(holder()).toBe(OWN_PID)
	})

	it('starts nothing where no launch id names this supervisor', () => {
		vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, undefined)

		expect(run_ship_relaunch.relaunch(request())).toBeUndefined()
		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('answers no successor where the launch failed', () => {
		launch_mock.mockReturnValue({ kind: 'failed', note: 'pnpm not found' })

		expect(run_ship_relaunch.relaunch(request())).toBeUndefined()
	})
})

describe('run_ship_relaunch.holder_pid', () => {
	it("answers the successor's pid once it claimed the record", () => {
		write_record(SUCCESSOR_PID, SUCCESSOR_START)

		expect(holder()).toBe(SUCCESSOR_PID)
	})
})
