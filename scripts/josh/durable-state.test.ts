import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_dispatch_log } from '#scripts/lane/lane-dispatch-log'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_state } from '#scripts/lane/lane-state'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { run_wake } from '#scripts/run/wake/run-wake'
import { afterAll, describe, expect, it } from 'vitest'
import { durable_state } from './durable-state'
import { PLATFORM_TEMP_ROOT, platform_temporary } from './platform-temporary'
import { stamp_file } from './stamp-file'

// joshuafolkken/kit#4743: a reboot emptied `/tmp` and took every run record with it — the lane states,
// the ledger, the events and a parked ship's log — so these records moved to the common git directory.

const TEST_PREFIX = 'josh-durable-state-test-'
const COMMON_GIT_DIRECTORY = '/repository/.git'
const OVERRIDE_ROOT = '/scratch/josh-temp'
const LEGACY_TEXT = '{"from":"tmp"}'
const RECORD = { kept: 'across a reboot' }
const ISSUE = '4743'
const OVERRIDE_STATE_DIRECTORY = 'josh-state'

const scratch = mkdtempSync(path.join(PLATFORM_TEMP_ROOT, TEST_PREFIX))
const written: Array<string> = []

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
	for (const target of written) rmSync(target, { force: true })
})

function key_root(name: string): string {
	return path.join(scratch, name)
}

function tracked(target: string): string {
	written.push(target)

	return target
}

function legacy_of(target: string): string {
	return path.join(PLATFORM_TEMP_ROOT, path.basename(target))
}

function dispatch_log_path(directory: string): string {
	return lane_dispatch_log.default_log_path({
		issue: ISSUE,
		branch: ISSUE,
		directory,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	})
}

describe('durable_state.state_root', () => {
	it('keeps run state in the josh directory of the common git directory', () => {
		expect(durable_state.state_root(undefined, COMMON_GIT_DIRECTORY)).toBe(
			path.join(COMMON_GIT_DIRECTORY, 'josh', 'run-state'),
		)
	})

	it('moves beneath an explicit temp root, as the unit suite and live evidence set one', () => {
		expect(durable_state.state_root(OVERRIDE_ROOT, COMMON_GIT_DIRECTORY)).toBe(
			path.join(OVERRIDE_ROOT, OVERRIDE_STATE_DIRECTORY),
		)
	})

	it('falls back to the temp root outside a repository', () => {
		expect(durable_state.state_root('', undefined)).toBe(PLATFORM_TEMP_ROOT)
	})
})

describe('durable_state.root', () => {
	// The network guard sets `JOSH_TEMP_ROOT` for the whole unit run, so no test writes into the
	// real `.git/josh/run-state` of the checkout it runs in.
	it('resolves inside the test run temp root, never the real common git directory', () => {
		expect(process.env[platform_temporary.TEMP_ROOT_KEY]).toBe(PLATFORM_TEMP_ROOT)
		expect(durable_state.root()).toBe(path.join(PLATFORM_TEMP_ROOT, OVERRIDE_STATE_DIRECTORY))
	})
})

describe('durable_state.path', () => {
	it('names the stamp file name in the durable root and creates the directory', () => {
		const target = tracked(durable_state.path(TEST_PREFIX, key_root('fresh')))

		expect(path.dirname(target)).toBe(durable_state.root())
		expect(path.basename(target)).toBe(stamp_file.stamp_name(TEST_PREFIX, key_root('fresh')))
		expect(existsSync(path.dirname(target))).toBe(true)
	})

	it('reads a record back after the temp root own files are cleared, as a reboot clears /tmp', () => {
		const target = tracked(durable_state.path(TEST_PREFIX, key_root('reboot')))

		stamp_file.replace_stamp(target, RECORD)
		rmSync(legacy_of(target), { force: true })

		expect(JSON.parse(stamp_file.read_stamp_text(target) ?? '')).toStrictEqual(RECORD)
	})
})

describe('durable_state.path after a record is removed', () => {
	// The review of #4743: copying from `/tmp` on every lookup brought back an ended carry, a stopped
	// launch and a failed ship's result from the original left there.
	it('does not bring a removed record back from the temp root', () => {
		const target = tracked(durable_state.path(durable_state.PREFIX.CARRY, key_root('removed')))

		writeFileSync(tracked(legacy_of(target)), LEGACY_TEXT, { mode: 0o600 })
		stamp_file.replace_stamp(target, RECORD)
		stamp_file.remove_stamp(target)

		expect(durable_state.path(durable_state.PREFIX.CARRY, key_root('removed'))).toBe(target)
		expect(existsSync(target)).toBe(false)
	})
})

describe('durable_state.ensure', () => {
	it('creates a missing directory and answers it', () => {
		const directory = path.join(scratch, 'ensured', 'run-state')

		expect(durable_state.ensure(directory)).toBe(directory)
		expect(existsSync(directory)).toBe(true)
	})

	// A sandbox that may not write the common git directory still runs on the temp root.
	it('answers the temp root when the directory cannot be created', () => {
		const blocker = path.join(scratch, 'blocker')

		writeFileSync(blocker, LEGACY_TEXT)

		expect(durable_state.ensure(path.join(blocker, 'run-state'))).toBe(PLATFORM_TEMP_ROOT)
	})
})

describe('the run records kept across a reboot', () => {
	const repository = key_root('records')

	it.each([
		['the carry record', (): string => run_carry.carry_path(repository)],
		['the ended record', (): string => run_carry_ended.ended_path(repository)],
		['a lane state', (): string => lane_state.state_path(repository, ISSUE)],
		['the event stream', (): string => run_event_stream.target_of(repository)],
		['the lane ledger', (): string => lane_ledger.target_of(repository)],
		['the supervisor log', (): string => run_wake.wake_log_path(repository)],
		['the detached ship log', (): string => run_ship_detach.log_path(repository, ISSUE)],
		['the detached ship result', (): string => run_ship_detach.result_path(repository, ISSUE)],
		['the backlogrun launch record', (): string => backlogrun_launch.launch_path(repository)],
		['the backlogrun log', (): string => backlogrun_launch.log_path(repository)],
		['the lane dispatch log', (): string => dispatch_log_path(repository)],
	])('keeps %s in the durable root', (_name, resolve) => {
		const target = tracked(resolve())

		expect(path.dirname(target)).toBe(durable_state.root())
	})
})
