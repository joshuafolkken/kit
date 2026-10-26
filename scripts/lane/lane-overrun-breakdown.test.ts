import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_overrun } from './lane-overrun'

// joshuafolkken/kit#4995: the overrun investigation saw only a lane's total, so its breakdown goes on
// the lane's Issue once, before the session starts, and leads the session's prompt.

const mocks = vi.hoisted(() => ({
	all_events: vi.fn(),
	comment: vi.fn<(issue: string, body: string) => Promise<boolean>>(),
	emit: vi.fn<(kind: string, text: string) => Promise<void>>(),
	launch: vi.fn<(request: { env: Readonly<Record<string, string>> }) => unknown>(),
	read_entries: vi.fn(),
	resolve_in: vi.fn<(invocation: string) => unknown>(),
	directories: vi.fn<() => ReadonlyArray<string>>(),
}))

vi.mock(import('./lane-ledger'), async (import_original) => {
	const { lane_ledger } = await import_original()

	return {
		lane_ledger: {
			...lane_ledger,
			read_entries: mocks.read_entries,
			target: async () => '/ledger.jsonl',
		},
	}
})
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { all_events: mocks.all_events, emit: mocks.emit },
}))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch: mocks.launch, note_of: (error: Error) => error.message },
}))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_try_comment: mocks.comment },
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: mocks.resolve_in } }))
vi.mock('#scripts/josh/process-identity', () => ({
	process_identity: { read_start: () => undefined },
}))
vi.mock('#scripts/cost-runtime/cost-transcript', () => ({
	cost_transcript: {
		home_directory: () => '/home',
		lane_transcript_directories: mocks.directories,
		list_sessions_across: () => [],
		session_cwd: (cwd: string) => cwd,
	},
}))

const ISSUE = 4970
const MINUTE_MS = 60_000
const START = Date.parse('2026-10-26T05:43:00.000Z')
const LANE = `#${String(ISSUE)}`

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function lane(minutes: number): ReadonlyArray<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(minutes), issue: ISSUE },
	]
}

function plan(): RunEvent {
	return { pos: 1, at: at(10), kind: 'plan', text: `${LANE} plan` }
}

function launched_prompt(): string {
	return mocks.resolve_in.mock.calls.map(([invocation]) => invocation).join('\n')
}

function notes(): ReadonlyArray<string> {
	return mocks.emit.mock.calls.map(([, text]) => text)
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.all_events.mockResolvedValue([plan()])
	mocks.read_entries.mockReturnValue(lane(61))
	mocks.comment.mockResolvedValue(true)
	mocks.resolve_in.mockReturnValue({ kind: 'argv', argv: { command: 'claude', args: [] } })
	mocks.launch.mockReturnValue({ kind: 'launched', pid: 1 })
	mocks.directories.mockReturnValue([])
})

describe('lane_overrun.investigate — the breakdown of an overrun', () => {
	it('comments the breakdown on the lane before launching the session', async () => {
		await lane_overrun.investigate(ISSUE)

		expect(mocks.comment).toHaveBeenCalledOnce()
		expect(mocks.comment).toHaveBeenCalledWith(
			String(ISSUE),
			expect.stringContaining('\n- implement 51.0 min'),
		)
		expect(mocks.comment.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.launch.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('leads the prompt with the breakdown', async () => {
		await lane_overrun.investigate(ISSUE)

		expect(launched_prompt()).toMatch(/^Net time by stage, longest first: implement 51\.0 min /u)
	})

	it('carries the longest stage on the start note', async () => {
		await lane_overrun.investigate(ISSUE)

		expect(notes()).toStrictEqual([
			`${LANE} overran: 61 min net, longest implement 51 min — investigating in pid 1`,
		])
	})

	it('launches the session even when the comment is refused', async () => {
		mocks.comment.mockResolvedValue(false)

		await lane_overrun.investigate(ISSUE)

		expect(mocks.launch).toHaveBeenCalledOnce()
	})
})

// The breakdown reads the same directories, so they moved to `lane-breakdown-implement.ts`.
describe('lane_overrun.investigate — the transcripts the session reads', () => {
	it("points the session at the lane's own transcript directories alone", async () => {
		const own = '/home/kit-lanes-4970'
		const other = '/home/kit-lanes-4971'

		mocks.directories.mockReturnValue([own, other])

		await lane_overrun.investigate(ISSUE)

		expect(launched_prompt()).toContain(own)
		expect(launched_prompt()).not.toContain(other)
	})
})

describe('lane_overrun.investigate — a pass after one that threw', () => {
	it('launches again without commenting the breakdown twice', async () => {
		const thrown: RunEvent = {
			pos: 2,
			at: at(61),
			kind: 'note',
			text: `${LANE} overrun investigation failed: no profile`,
		}

		mocks.all_events.mockResolvedValue([plan(), thrown])

		await lane_overrun.investigate(ISSUE)

		expect(mocks.comment).not.toHaveBeenCalled()
		expect(mocks.launch).toHaveBeenCalledOnce()
	})
})
