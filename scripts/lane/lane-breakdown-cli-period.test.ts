import { session_language } from '#scripts/josh/session-language'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_breakdown_cli } from './lane-breakdown-cli'
import type { LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#8998: `josh lane:breakdown --period <days>` prints each implement-split segment's
// median over the lanes merged in the last `days` days.

const mocks = vi.hoisted(() => ({
	all_events: vi.fn(),
	read_entries: vi.fn<(path: string) => ReadonlyArray<LedgerEntry>>(),
	target: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock(import('./lane-ledger'), async (import_original) => {
	const { lane_ledger } = await import_original()

	// The archive beside the ledger (`lane-ledger-archive.ts`) holds nothing here.
	function read_entries(file: string): ReadonlyArray<LedgerEntry> {
		return file.endsWith('-archive.jsonl') ? [] : mocks.read_entries(file)
	}

	return { lane_ledger: { ...lane_ledger, read_entries, target: mocks.target } }
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
const MINUTE_MS = 60_000
const START = Date.now() - 2 * 60 * MINUTE_MS

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

beforeEach(() => {
	vi.stubEnv(session_language.ENV_KEY, 'en')
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
	mocks.target.mockResolvedValue('/ledger.jsonl')
	mocks.all_events.mockResolvedValue([
		{ pos: 1, at: at(10), kind: 'plan', text: `#${String(ISSUE)} plan` },
	])
	mocks.read_entries.mockReturnValue([
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{
			kind: 'chain-stage',
			at: at(40),
			issue: ISSUE,
			name: 'run:review',
			result: 'passed',
			elapsed_ms: 5 * MINUTE_MS,
		},
		{ kind: 'merge', at: at(61), issue: ISSUE },
	])
})

describe('lane_breakdown_cli.run — --period', () => {
	it('prints the segment medians over the lanes merged in the window', async () => {
		await expect(lane_breakdown_cli.run(['--period', '1'])).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('lanes merged in the last 1 days: 1 of 1 split'),
		)
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('- review wait: median 5.0 min, in 1 of 1 runs'),
		)
	})

	it.each([[['--period']], [['--period', '0']], [['--period', 'x']], [['--period', '7', '1']]])(
		'refuses a malformed period with the usage: %j',
		async (args) => {
			await expect(lane_breakdown_cli.run(args)).resolves.toBe(FAILURE)
			expect(console.error).toHaveBeenCalledWith(lane_breakdown_cli.USAGE)
		},
	)
})
