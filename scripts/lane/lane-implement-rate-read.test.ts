import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_implement_rate_read } from './lane-implement-rate-read'
import { lane_ledger } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_net_read } from './lane-net-read'

const make_directory = temporary_directory('suite')

const scratch = make_directory('lane-implement-rate-read-test-')
const ISSUE = 6464
const DISPATCHED_AT = '2026-10-24T03:00:00.000Z'
const MERGED_AT = '2026-10-24T03:30:00.000Z'
const NOW_MS = Date.parse('2026-10-24T04:00:00.000Z')
const EXPECTED_RATE = { median: 10, lanes: 1 }
const PERIOD_DAYS = 3
const BOUNDARY = Date.parse('2026-10-27T03:30:00.000Z')

afterEach(() => {
	vi.restoreAllMocks()
})

function context_of(): { ledger_path: string; events_path: string } {
	return {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
	}
}

// Twenty implement minutes for 200 actual lines, followed by a merge ten minutes later.
function measured_context(): ReturnType<typeof context_of> {
	const context = context_of()
	const shipped_at = '2026-10-24T03:20:00.000Z'

	for (const entry of [
		{ kind: 'dispatch', at: DISPATCHED_AT, issue: ISSUE },
		{ kind: 'stage', at: shipped_at, stage: 'preflight', elapsed_ms: 0, issue: ISSUE },
		{
			kind: 'size',
			at: shipped_at,
			issue: ISSUE,
			declared: { files: 1, lines: 100 },
			actual: { files: 1, lines: 200 },
		},
		{ kind: 'merge', at: MERGED_AT, issue: ISSUE },
	] as const) {
		lane_ledger_write.append(context.ledger_path, entry)
	}

	return context
}

function context_tests(reader: Pick<typeof lane_net_read, 'implement_rate'>): void {
	it('excludes a merge after the injected date', async () => {
		await expect(
			reader.implement_rate(measured_context(), Date.parse(DISPATCHED_AT)),
		).resolves.toBeUndefined()
	})

	it('resolves the default ledger and current date', async () => {
		const context = measured_context()

		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(context.ledger_path)
		vi.spyOn(Date, 'now').mockReturnValueOnce(NOW_MS)
		await expect(reader.implement_rate()).resolves.toStrictEqual(EXPECTED_RATE)
	})

	it('is undefined when the default ledger is unavailable', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(undefined)
		await expect(reader.implement_rate()).resolves.toBeUndefined()
	})
}

describe.each([
	['independent reader', lane_implement_rate_read],
	['net reader', lane_net_read],
] as const)('%s implement_rate', (_name, reader) => {
	it('reads the measured rate with an injected ledger and date (ac-d974d9d2)', async () => {
		await expect(reader.implement_rate(measured_context(), NOW_MS)).resolves.toStrictEqual(
			EXPECTED_RATE,
		)
	})

	it('is undefined for an empty ledger', async () => {
		const context = context_of()

		writeFileSync(context.ledger_path, '')
		await expect(reader.implement_rate(context, NOW_MS)).resolves.toBeUndefined()
	})

	it('is undefined for an unreadable ledger', async () => {
		await expect(reader.implement_rate({ ledger_path: scratch }, NOW_MS)).resolves.toBeUndefined()
	})

	it('is undefined when no merged lane measured a rate', async () => {
		const context = context_of()

		lane_ledger_write.append(context.ledger_path, {
			kind: 'dispatch',
			at: DISPATCHED_AT,
			issue: ISSUE,
		})
		await expect(reader.implement_rate(context, NOW_MS)).resolves.toBeUndefined()
	})

	it('includes the three-day boundary and excludes older merges', async () => {
		const context = measured_context()
		const boundary = BOUNDARY

		expect(lane_implement_rate_read.PERIOD_DAYS).toBe(PERIOD_DAYS)
		await expect(reader.implement_rate(context, boundary)).resolves.toStrictEqual(EXPECTED_RATE)
		await expect(reader.implement_rate(context, boundary + 1)).resolves.toBeUndefined()
	})

	context_tests(reader)
})

describe('measurements', () => {
	it('reads growth without an implement duration (ac-4b828b0f)', async () => {
		const context = context_of()

		lane_ledger_write.append(context.ledger_path, {
			kind: 'size',
			at: DISPATCHED_AT,
			issue: ISSUE,
			declared: { files: 2, lines: 100 },
			actual: { files: 3, lines: 120 },
		})
		lane_ledger_write.append(context.ledger_path, { kind: 'merge', at: MERGED_AT, issue: ISSUE })
		await expect(lane_implement_rate_read.measurements(context, NOW_MS)).resolves.toEqual({
			implement_rate: undefined,
			growth: { files: 1.5, lines: 1.2 },
		})
	})

	it('shares the three-day boundary with rate measurement (ac-4b828b0f)', async () => {
		const context = measured_context()
		const boundary = BOUNDARY

		await expect(lane_implement_rate_read.measurements(context, boundary)).resolves.toEqual({
			implement_rate: EXPECTED_RATE,
			growth: { files: 1, lines: 2 },
		})
		await expect(lane_implement_rate_read.measurements(context, boundary + 1)).resolves.toEqual({
			implement_rate: undefined,
			growth: {},
		})
	})
})
