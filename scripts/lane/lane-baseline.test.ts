import { run_event_baseline } from '#scripts/run/event/run-event-baseline'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_baseline } from './lane-baseline'
import type { LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#4887: every 30th merge launches one baseline investigation of the median lane, by
// the overrun investigation's filing rules, and notes it on the stream.

const mocks = vi.hoisted(() => ({
	all_events: vi.fn<() => Promise<ReadonlyArray<RunEvent>>>(),
	emit: vi.fn<(kind: string, text: string) => Promise<void>>(),
	launch: vi.fn<(request: { env: Readonly<Record<string, string>> }) => unknown>(),
	read_entries: vi.fn<() => ReadonlyArray<LedgerEntry>>(),
	read_start: vi.fn<(pid: number) => string | undefined>(),
	resolve_in: vi.fn<(invocation: string) => unknown>(),
	target: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock(import('./lane-ledger'), async (import_original) => {
	const { lane_ledger } = await import_original()

	return { lane_ledger: { ...lane_ledger, read_entries: mocks.read_entries, target: mocks.target } }
})
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { all_events: mocks.all_events, emit: mocks.emit },
}))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch: mocks.launch, note_of: (error: Error) => error.message },
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: mocks.resolve_in } }))
vi.mock('#scripts/josh/process-identity', () => ({
	process_identity: { read_start: mocks.read_start },
}))

const ISSUE = 4887
const PID = 321
const AT = '2026-10-25T03:00:00.000Z'

function merges(count: number): ReadonlyArray<LedgerEntry> {
	return Array.from({ length: count }, (_, index) => ({ kind: 'merge', at: AT, issue: index + 1 }))
}

function note(text: string): RunEvent {
	return { pos: 1, at: AT, kind: 'note', text }
}

function emitted(): ReadonlyArray<string> {
	return mocks.emit.mock.calls.map(([, text]) => text)
}

function launched_prompt(): string {
	return mocks.resolve_in.mock.calls.map(([invocation]) => invocation).join('\n')
}

afterEach(() => vi.unstubAllEnvs())

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubEnv('JOSH_LANE_INVESTIGATION', 'on')
	mocks.target.mockResolvedValue('/state/lane-ledger.jsonl')
	mocks.all_events.mockResolvedValue([])
	mocks.emit.mockResolvedValue()
	mocks.resolve_in.mockReturnValue({ kind: 'built', argv: ['claude'], profile: 'worker' })
	mocks.launch.mockReturnValue({ kind: 'launched', pid: PID })
	mocks.read_start.mockReturnValue(undefined)
})

describe('lane_baseline.due_bucket — the interval', () => {
	it('is the last multiple of 30 the count reached', () => {
		const counts = [0, 1, 29, 30, 31, 59, 60]

		expect(counts.map((count) => lane_baseline.due_bucket(count))).toStrictEqual([
			0, 0, 0, 30, 30, 30, 60,
		])
	})
})

describe('lane_baseline.investigate — the launch', () => {
	it('launches one session at the 30th merge and notes it', async () => {
		mocks.read_entries.mockReturnValue(merges(30))

		await lane_baseline.investigate(ISSUE)

		expect(mocks.launch).toHaveBeenCalledTimes(1)
		expect(emitted()).toStrictEqual([
			run_event_baseline.started_text(30, `investigating in pid ${String(PID)}`),
		])
	})

	it('asks again after a failure, which names no count', async () => {
		mocks.read_entries.mockReturnValue(merges(30))
		mocks.all_events.mockResolvedValue([note(run_event_baseline.failed_text('spawn failed'))])

		await lane_baseline.investigate(ISSUE)

		expect(mocks.launch).toHaveBeenCalledTimes(1)
	})

	it('notes a thrown error instead of failing the merge', async () => {
		const message = 'ledger unreadable'

		mocks.target.mockRejectedValue(new Error(message))

		await expect(lane_baseline.investigate(ISSUE)).resolves.toBeUndefined()
		expect(emitted()).toStrictEqual([run_event_baseline.failed_text(message)])
	})
})

describe('lane_baseline.investigate — the due bucket', () => {
	it('launches for a bucket a skipped ask left behind, once the count is past it', async () => {
		mocks.read_entries.mockReturnValue(merges(31))

		await lane_baseline.investigate(ISSUE)

		expect(emitted()).toStrictEqual([
			run_event_baseline.started_text(30, `investigating in pid ${String(PID)}`),
		])
	})

	it('launches nothing before the first bucket', async () => {
		mocks.read_entries.mockReturnValue(merges(29))

		await lane_baseline.investigate(ISSUE)

		expect(mocks.launch).not.toHaveBeenCalled()
		expect(emitted()).toStrictEqual([])
	})

	it('launches nothing when the bucket is on the stream already, though the count moved past it', async () => {
		mocks.read_entries.mockReturnValue(merges(31))
		mocks.all_events.mockResolvedValue([note(run_event_baseline.ended_text(30, 'filed'))])

		await lane_baseline.investigate(ISSUE)

		expect(mocks.launch).not.toHaveBeenCalled()
	})
})

describe('lane_baseline.investigate — the prompt', () => {
	it("follows the overrun investigation's filing rules and records the result as its note", async () => {
		mocks.read_entries.mockReturnValue(merges(30))

		await lane_baseline.investigate(ISSUE)

		for (const part of [
			'pnpm josh lane:stats --period 3',
			'take the several stages and sub-stages with the largest per-merge time, not just the one largest',
			"Estimate each cause's reducible minutes: what its fix would cut from the median merge",
			'Take at most the 5 causes with the most reducible minutes',
			`- 原因のレーン: <median lane minutes> 分（#${String(ISSUE)}）`,
			`pnpm josh run:event --append note "${run_event_baseline.ended_text(30, '<result>')}"`,
		]) {
			expect(launched_prompt()).toContain(part)
		}
	})

	it('files with no lane it was found during, and judges no share (joshuafolkken/kit#4928)', async () => {
		mocks.read_entries.mockReturnValue(merges(30))

		await lane_baseline.investigate(ISSUE)

		expect(launched_prompt()).toContain('`pnpm josh issue:file`')
		expect(launched_prompt()).not.toContain('--found-during')
		expect(launched_prompt()).not.toContain('%')
	})

	it('launches the session with no lane marks in its env', async () => {
		mocks.read_entries.mockReturnValue(merges(30))

		await lane_baseline.investigate(ISSUE)

		expect(mocks.launch.mock.calls.map(([request]) => request.env)).toStrictEqual([{}])
	})
})

// joshuafolkken/kit#5044: the investigations are off unless `JOSH_LANE_INVESTIGATION` is on.
describe('lane_baseline.investigate — the switch off', () => {
	it.each([undefined, 'off'])(
		'launches and notes nothing at a due merge with %j',
		async (value) => {
			vi.stubEnv('JOSH_LANE_INVESTIGATION', value)
			mocks.read_entries.mockReturnValue(merges(30))

			await lane_baseline.investigate(ISSUE)

			expect(mocks.launch).not.toHaveBeenCalled()
			expect(emitted()).toStrictEqual([])
		},
	)
})
