import { agent_safe_text } from '#scripts/agent/agent-safe-text'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_overrun } from './lane-overrun'

// joshuafolkken/kit#4930: #4916's 70-minute overrun was refused its launch, and a refused launch was
// final, so the lane went without an investigation.

const mocks = vi.hoisted(() => ({
	all_events: vi.fn(),
	emit: vi.fn<(kind: string, text: string) => Promise<void>>(),
	launch: vi.fn<(request: { env: Readonly<Record<string, string>> }) => unknown>(),
	read_entries: vi.fn(),
	resolve_in: vi.fn<(invocation: string) => unknown>(),
	transcripts: vi.fn(),
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
	git_gh_issue_write: { issue_try_comment: async () => true },
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: mocks.resolve_in } }))
vi.mock('#scripts/josh/process-identity', () => ({
	process_identity: { read_start: () => undefined },
}))
vi.mock('#scripts/cost-runtime/cost-transcript', () => ({
	cost_transcript: {
		home_directory: () => '/home',
		lane_transcript_directories: mocks.transcripts,
		session_cwd: (cwd: string) => cwd,
	},
}))

const ISSUE = 4916
const OTHER = 4917
const MINUTE_MS = 60_000
const START = Date.parse('2026-10-25T15:00:00.000Z')
// The transcript directory #4916's investigation was handed.
const TRANSCRIPTS =
	'/Users/iwasakishinya/.claude/projects/-Users-iwasakishinya-Development--kit-lanes-4916'

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function lane(minutes: number): ReadonlyArray<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(minutes), issue: ISSUE },
	]
}

function failed_launch(pos: number): RunEvent {
	return {
		pos,
		at: at(70),
		kind: 'note',
		text: `#${String(ISSUE)} overran: 70 min net — not investigated: refused`,
	}
}

function launched_prompt(): string {
	return mocks.resolve_in.mock.calls.map(([invocation]) => invocation).join('\n')
}

function notes(): ReadonlyArray<string> {
	return mocks.emit.mock.calls.map(([, text]) => text)
}

function launched_lanes(): ReadonlyArray<string | undefined> {
	return mocks.launch.mock.calls.map(([{ env }]) => env['JOSH_LANE_CHILD'])
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.all_events.mockResolvedValue([])
	mocks.read_entries.mockReturnValue(lane(70))
	mocks.transcripts.mockReturnValue([TRANSCRIPTS])
	mocks.resolve_in.mockReturnValue({ kind: 'argv', argv: { command: 'claude', args: [] } })
	mocks.launch.mockReturnValue({ kind: 'launched', pid: 1 })
})

describe('lane_overrun.investigate — the launch of #4916’s overrun', () => {
	it('carries a prompt the launch gate accepts', async () => {
		await lane_overrun.investigate(ISSUE)

		expect(agent_safe_text.is_safe_prompt(launched_prompt())).toBe(true)
	})
})

describe('lane_overrun.investigate — a lane whose launch failed', () => {
	it('is launched once more', async () => {
		mocks.all_events.mockResolvedValue([failed_launch(1)])

		await lane_overrun.investigate(ISSUE)

		expect(launched_lanes()).toStrictEqual([String(ISSUE)])
	})

	it('is not launched after its retry failed too', async () => {
		mocks.all_events.mockResolvedValue([failed_launch(1), failed_launch(2)])

		await lane_overrun.investigate(ISSUE)

		expect(mocks.launch).not.toHaveBeenCalled()
	})

	it('is not swept up again by another lane’s merge after its retry threw', async () => {
		const thrown: RunEvent = {
			pos: 2,
			at: at(70),
			kind: 'note',
			text: `#${String(ISSUE)} overrun investigation failed: no profile`,
		}

		mocks.all_events.mockResolvedValue([failed_launch(1), thrown])

		await lane_overrun.investigate(OTHER)

		expect(mocks.launch).not.toHaveBeenCalled()
	})

	it('is retried at the next merge of another lane', async () => {
		mocks.all_events.mockResolvedValue([failed_launch(1)])

		await lane_overrun.investigate(OTHER)

		expect(launched_lanes()).toStrictEqual([String(ISSUE)])
		expect(notes().some((text) => text.startsWith(`#${String(OTHER)} overrun skipped: `))).toBe(
			true,
		)
	})
})
