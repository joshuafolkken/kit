import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { usage_state_path } from '#scripts/usage/usage-state-path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_quota_status } from './run-board-quota-status'

const make_directory = temporary_directory()

const AT = '2026-11-04T12:00:00Z'
const WINDOW = { used_percentage: 42, resets_at: 1000 }
const RECORD = { five_hour: WINDOW, seven_day: WINDOW, at: AT }
const READING = {
	windows: [
		{ minutes: 300, used_percent: 42, resets_ms: 1_000_000 },
		{ minutes: 10_080, used_percent: 42, resets_ms: 1_000_000 },
	],
	taken_ms: Date.parse(AT),
}

describe('run_board_quota_status parsing and selection', () => {
	it('converts the saved percentages, reset seconds and observation time', () => {
		expect(run_board_quota_status.parse(JSON.stringify(RECORD))).toEqual(READING)
	})

	it.each(['{', '{}', JSON.stringify({ ...RECORD, at: 'invalid' })])(
		'ignores invalid records: %s',
		(text) => {
			expect(run_board_quota_status.parse(text)).toBeUndefined()
		},
	)

	it('keeps unknown windows absent instead of refreshing stale values', () => {
		const text = `{"five_hour":null,"seven_day":null,"at":"${AT}"}`

		expect(run_board_quota_status.parse(text)).toEqual({ windows: [], taken_ms: Date.parse(AT) })
	})

	it('uses either source alone and returns none when both are absent', () => {
		expect(run_board_quota_status.newest(undefined, READING)).toEqual(READING)
		expect(run_board_quota_status.newest(READING, undefined)).toBe(READING)
		expect(run_board_quota_status.newest(undefined, undefined)).toBeUndefined()
	})

	it.each([-1, 1])('selects the newer observation with a log offset of %s', (offset) => {
		const per_task = Object.fromEntries([[300, 2]])
		const log = { ...READING, taken_ms: READING.taken_ms + offset, per_task }
		const expected = offset > 0 ? log : { ...READING, per_task: log.per_task }

		expect(run_board_quota_status.newest(log, READING)).toEqual(expected)
	})

	it('prefers a timed status record to an untimed log', () => {
		expect(run_board_quota_status.newest({ ...READING, taken_ms: undefined }, READING)).toEqual(
			READING,
		)
	})
})

describe('run_board_quota_status shared record', () => {
	let root = ''

	beforeEach(() => {
		root = make_directory('quota-status-')
		vi.stubEnv('CLAUDE_CONFIG_DIR', root)
	})

	afterEach(async () => {
		vi.unstubAllEnvs()
		await rm(root, { recursive: true, force: true })
	})

	it('reads the record at the shared usage path', async () => {
		const file = usage_state_path.claude()

		await mkdir(path.dirname(file), { recursive: true })
		await writeFile(file, JSON.stringify(RECORD))
		expect(await run_board_quota_status.read()).toEqual(READING)
	})

	it('returns none for a missing record', async () => {
		expect(await run_board_quota_status.read()).toBeUndefined()
	})
})
