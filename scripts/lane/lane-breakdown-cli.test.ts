import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_breakdown_cli } from './lane-breakdown-cli'
import type { LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#4995: `josh lane:breakdown <issue>` prints a merged lane's net time by stage, the
// same breakdown its overrun investigation comments on its Issue.

const mocks = vi.hoisted(() => ({
	all_events: vi.fn(),
	read_entries: vi.fn<(path: string) => ReadonlyArray<LedgerEntry>>(),
	target: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock(import('./lane-ledger'), async (import_original) => {
	const { lane_ledger } = await import_original()

	return { lane_ledger: { ...lane_ledger, read_entries: mocks.read_entries, target: mocks.target } }
})
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { all_events: mocks.all_events },
}))
vi.mock(import('./lane-breakdown-implement'), async (import_original) => {
	const { lane_breakdown_implement } = await import_original()

	return { lane_breakdown_implement: { ...lane_breakdown_implement, read: () => [] } }
})

const ISSUE = 4970
const FAILURE = 1
const START = Date.parse('2026-10-26T05:43:00.000Z')
const MINUTE_MS = 60_000

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
	mocks.target.mockResolvedValue('/ledger.jsonl')
	mocks.all_events.mockResolvedValue([
		{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` },
	])
	mocks.read_entries.mockReturnValue([
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(61), issue: ISSUE },
	])
})

describe('lane_breakdown_cli.run', () => {
	it('prints the stages longest first under the net minutes', async () => {
		await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(
			[
				'Net time by stage, longest first, 61 min of net time (`pnpm josh lane:breakdown 4970`):',
				'',
				'- implement 51.0 min (editing & thinking 51.0 min)',
				'- start to plan 10.0 min',
				'- waits taken out (park, outage, usage limit) 0.0 min',
			].join('\n'),
		)
	})

	it('refuses a lane the ledger holds no dispatch and merge of', async () => {
		mocks.read_entries.mockReturnValue([])

		await expect(lane_breakdown_cli.run([String(ISSUE)])).resolves.toBe(FAILURE)
		expect(console.info).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no dispatch and merge'))
	})

	it('prints the usage for anything but one issue number', async () => {
		await expect(lane_breakdown_cli.run([])).resolves.toBe(FAILURE)
		await expect(lane_breakdown_cli.run(['x'])).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_breakdown_cli.USAGE)
	})
})
