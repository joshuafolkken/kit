import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { durable_state_migrate } from './durable-state-migrate'
import { PLATFORM_TEMP_ROOT } from './platform-temporary'

// joshuafolkken/kit#4743: the records a run left in `/tmp` are copied into the durable directory once,
// and a log the durable directory keeps forever is pruned once it has not been written for two weeks.

const TEST_PREFIX = 'josh-durable-state-migrate-test-'
const LANE_STATE_PREFIX = 'josh-lane-state-'
const PREFIXES = [LANE_STATE_PREFIX, 'josh-run-wake-log-']
const LEGACY_TEXT = '{"state":"running"}'
const DURABLE_TEXT = '{"state":"ended"}'
const LANE_STATE_NAME = `${LANE_STATE_PREFIX}0123456789abcdef-4743.json`
const SHIP_PID_NAME = 'josh-ship-pid-0123456789abcdef.json'
const DAY_MS = 86_400_000
const NOW_MS = Date.parse('2026-10-25T00:00:00Z')
const STALE_DAYS = durable_state_migrate.LOG_RETENTION_DAYS + 1

const scratch = mkdtempSync(path.join(PLATFORM_TEMP_ROOT, TEST_PREFIX))

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

function directory_of(name: string): string {
	const directory = path.join(scratch, name)

	mkdirSync(directory, { recursive: true })

	return directory
}

function write_aged(target: string, age_days: number): string {
	const seconds = (NOW_MS - age_days * DAY_MS) / 1000

	writeFileSync(target, LEGACY_TEXT, { mode: 0o600 })
	utimesSync(target, seconds, seconds)

	return target
}

describe('durable_state_migrate.is_record_name', () => {
	it.each([
		[LANE_STATE_NAME, true],
		['josh-run-wake-log-0123456789abcdef.log', true],
		[`${LANE_STATE_NAME}.lock`, false],
		[`${LANE_STATE_NAME}.123.tmp`, false],
		['josh-run-wake-0123456789abcdef.json', false],
	])('answers %s with %s', (name, expected) => {
		expect(durable_state_migrate.is_record_name(name, PREFIXES)).toBe(expected)
	})
})

describe('durable_state_migrate.copy_once', () => {
	// The review of #4743: a lane state only `/tmp` held was missing from the lanes the board listed,
	// and a lane on this code may have created the durable directory before the copy was owed.
	it('copies a temp-root-only lane state into an existing directory and keeps the original', () => {
		const from = directory_of('copy-from')
		const to = directory_of('copy-to')

		writeFileSync(path.join(from, LANE_STATE_NAME), LEGACY_TEXT, { mode: 0o600 })
		durable_state_migrate.copy_once(from, to, PREFIXES)

		expect(readFileSync(path.join(to, LANE_STATE_NAME), 'utf8')).toBe(LEGACY_TEXT)
		expect(existsSync(path.join(from, LANE_STATE_NAME))).toBe(true)
	})

	// The review of #4743: copying again brought back a record a run removed on purpose.
	it('does not copy a second time after the durable record is removed', () => {
		const from = directory_of('once-from')
		const to = directory_of('once-to')

		writeFileSync(path.join(from, LANE_STATE_NAME), LEGACY_TEXT, { mode: 0o600 })
		durable_state_migrate.copy_once(from, to, PREFIXES)
		rmSync(path.join(to, LANE_STATE_NAME))
		durable_state_migrate.copy_once(from, to, PREFIXES)

		expect(existsSync(path.join(to, LANE_STATE_NAME))).toBe(false)
	})

	it('never overwrites a record the durable directory already holds', () => {
		const from = directory_of('keep-from')
		const to = directory_of('keep-to')

		writeFileSync(path.join(from, LANE_STATE_NAME), LEGACY_TEXT, { mode: 0o600 })
		writeFileSync(path.join(to, LANE_STATE_NAME), DURABLE_TEXT, { mode: 0o600 })
		durable_state_migrate.copy_once(from, to, PREFIXES)

		expect(readFileSync(path.join(to, LANE_STATE_NAME), 'utf8')).toBe(DURABLE_TEXT)
	})
})

describe('durable_state_migrate.copy_once with names that are not records', () => {
	it('leaves out a lock and a name no record has', () => {
		const from = directory_of('skip-from')
		const to = directory_of('skip-to')

		writeFileSync(path.join(from, `${LANE_STATE_NAME}.lock`), '')
		writeFileSync(path.join(from, SHIP_PID_NAME), '')
		durable_state_migrate.copy_once(from, to, PREFIXES)

		expect(existsSync(path.join(to, `${LANE_STATE_NAME}.lock`))).toBe(false)
		expect(existsSync(path.join(to, SHIP_PID_NAME))).toBe(false)
	})
})

describe('durable_state_migrate.prune_stale_logs', () => {
	it('removes only a log older than the retention', () => {
		const directory = directory_of('prune')
		const stale_log = write_aged(path.join(directory, 'josh-run-wake-log-stale.log'), STALE_DAYS)
		const fresh_log = write_aged(path.join(directory, 'josh-run-wake-log-fresh.log'), 1)
		const stale_record = write_aged(path.join(directory, LANE_STATE_NAME), STALE_DAYS)

		durable_state_migrate.prune_stale_logs(directory, PREFIXES, NOW_MS)

		expect(existsSync(stale_log)).toBe(false)
		expect(existsSync(fresh_log)).toBe(true)
		expect(existsSync(stale_record)).toBe(true)
	})
})
