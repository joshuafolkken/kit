import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_overrun } from './lane-overrun'

// joshuafolkken/kit#4751: a merged lane over 40 minutes of net time is investigated in a detached
// session that files its unfiled causes against the lane; one at or under it stops before its records.

const mocks = vi.hoisted(() => ({
	all_events: vi.fn(),
	emit: vi.fn<(kind: string, text: string) => Promise<void>>(),
	launch: vi.fn<(request: { env: Readonly<Record<string, string>> }) => unknown>(),
	read_entries: vi.fn(),
	resolve_in: vi.fn<(invocation: string) => unknown>(),
	target: vi.fn(),
	transcripts: vi.fn(),
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
vi.mock('#scripts/cost-runtime/cost-transcript', () => ({
	cost_transcript: {
		home_directory: () => '/home',
		lane_transcript_directories: mocks.transcripts,
		session_cwd: (cwd: string) => cwd,
	},
}))

const ISSUE = 4695
const MINUTE_MS = 60_000
const PID = 321
const START = Date.parse('2026-10-24T03:00:00.000Z')
const OWN_TRANSCRIPTS = '/home/.claude/projects/-kit-lanes-4695'

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function lane(minutes: number): ReadonlyArray<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(0), issue: ISSUE },
		{ kind: 'merge', at: at(minutes), issue: ISSUE },
	]
}

function park(minute: number): RunEvent {
	return { pos: minute, at: at(minute), kind: 'park', text: `#${String(ISSUE)} parked` }
}

function launched_prompt(): string {
	return mocks.resolve_in.mock.calls.map(([invocation]) => invocation).join('\n')
}

function launched_marks(): ReadonlyArray<string | undefined> {
	return mocks.launch.mock.calls.map(([request]) => request.env['JOSH_LANE_CHILD'])
}

function notes(): ReadonlyArray<string> {
	return mocks.emit.mock.calls.map(([, text]) => text)
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.target.mockResolvedValue('/ledger.jsonl')
	mocks.all_events.mockResolvedValue([])
	mocks.transcripts.mockReturnValue([OWN_TRANSCRIPTS, '/home/.claude/projects/-kit-lanes-14695'])
	mocks.resolve_in.mockReturnValue({ kind: 'argv', argv: { command: 'claude', args: [] } })
	mocks.launch.mockReturnValue({ kind: 'launched', pid: PID })
})

describe('lane_overrun.investigate — a lane at or under 40 minutes', () => {
	it('stops before reading any record of a 40-minute lane', async () => {
		mocks.read_entries.mockReturnValue(lane(40))

		await lane_overrun.investigate(ISSUE)

		expect(mocks.transcripts).not.toHaveBeenCalled()
		expect(mocks.launch).not.toHaveBeenCalled()
		expect(mocks.emit).not.toHaveBeenCalled()
	})

	it('stops on a lane long only for its wait on a person', async () => {
		mocks.read_entries.mockReturnValue(lane(70))
		mocks.all_events.mockResolvedValue([park(30)])

		await lane_overrun.investigate(ISSUE)

		expect(mocks.launch).not.toHaveBeenCalled()
	})

	it('stops where no ledger is kept', async () => {
		mocks.target.mockResolvedValue(undefined)

		await lane_overrun.investigate(ISSUE)

		expect(mocks.launch).not.toHaveBeenCalled()
	})
})

describe('lane_overrun.investigate — a lane over 40 minutes', () => {
	beforeEach(() => {
		mocks.read_entries.mockReturnValue(lane(41))
	})

	it('launches a detached session carrying the lane mark, so its filings count against the lane', async () => {
		await lane_overrun.investigate(ISSUE)

		expect(launched_marks()).toStrictEqual([String(ISSUE)])
	})

	it('asks for filings against the lane with its causing-lane line', async () => {
		await lane_overrun.investigate(ISSUE)

		expect(launched_prompt()).toContain(`pnpm josh issue:file --found-during ${String(ISSUE)}`)
		expect(launched_prompt()).toContain(`- 原因のレーン: 41 分（#${String(ISSUE)}）`)
	})

	it("names only the lane's own transcripts", async () => {
		await lane_overrun.investigate(ISSUE)

		expect(launched_prompt()).toContain(OWN_TRANSCRIPTS)
		expect(launched_prompt()).not.toContain('14695')
	})
})

// joshuafolkken/kit#4762: the first overrun found two causes and filed neither, told a duplicate refusal
// was final, and stopped tracing a cause at what took the time.
describe('lane_overrun.investigate — what the session does with a cause', () => {
	beforeEach(async () => {
		mocks.read_entries.mockReturnValue(lane(41))
		await lane_overrun.investigate(ISSUE)
	})

	it('reads each duplicate candidate and reissues a distinct one rather than stopping', () => {
		expect(launched_prompt()).not.toContain('duplicate or cap refusal from issue:file is final')
		expect(launched_prompt()).toContain('pnpm josh issue:read <N>')
		expect(launched_prompt()).toContain('--distinct <N,…>')
	})

	it('records a recurrence on an open candidate fixing the same mechanism, filing nothing new', () => {
		expect(launched_prompt()).toContain(
			'is not filed again but gets a comment recording the recurrence with those four',
		)
	})

	it('files a recurrence of a candidate closed before the lane, declared distinct', () => {
		expect(launched_prompt()).toContain(
			'closed before this lane yet recurring here is filed anew as a recurrence, its number in `--distinct`',
		)
	})

	it('keeps a cap refusal final', () => {
		expect(launched_prompt()).toContain('A cap refusal is final: stop filing.')
	})

	it('traces each cause to its signal, its deciding file:line and its fix, into the body', () => {
		for (const part of [
			'the span it spent',
			'which command printed what',
			'`file:line`',
			'where to fix it',
		]) {
			expect(launched_prompt()).toContain(part)
		}

		expect(launched_prompt()).toContain('its body carrying those four')
	})
})

describe('lane_overrun.investigate — the record of an overrun', () => {
	beforeEach(() => {
		mocks.read_entries.mockReturnValue(lane(41))
	})

	it('records the launch and asks the session to record its result', async () => {
		await lane_overrun.investigate(ISSUE)

		expect(notes()).toStrictEqual([
			`#${String(ISSUE)} overran: 41 min net — investigating in pid 321`,
		])
		expect(launched_prompt()).toContain('pnpm josh run:event --append note')
	})

	it('records a launch that failed', async () => {
		mocks.launch.mockReturnValue({ kind: 'failed', note: 'no pid' })

		await lane_overrun.investigate(ISSUE)

		expect(notes()).toStrictEqual([
			`#${String(ISSUE)} overran: 41 min net — not investigated: no pid`,
		])
	})

	it('records an error rather than failing the merge', async () => {
		mocks.resolve_in.mockImplementation(() => {
			throw new Error('no profile')
		})

		await expect(lane_overrun.investigate(ISSUE)).resolves.toBeUndefined()
		expect(notes()).toStrictEqual([`#${String(ISSUE)} overrun investigation failed: no profile`])
	})
})

describe('lane_overrun.investigate — a lane already investigated or refused a session', () => {
	beforeEach(() => {
		mocks.read_entries.mockReturnValue(lane(41))
	})

	it('launches once for a lane already on the stream', async () => {
		const note: RunEvent = {
			pos: 1,
			at: at(41),
			kind: 'note',
			text: `#${String(ISSUE)} overran: 41 min net — investigating in pid 1`,
		}

		mocks.all_events.mockResolvedValue([note])

		await lane_overrun.investigate(ISSUE)

		expect(mocks.launch).not.toHaveBeenCalled()
		expect(mocks.emit).not.toHaveBeenCalled()
	})

	it('records a session the profile refused', async () => {
		mocks.resolve_in.mockReturnValue({ kind: 'rejected', note: 'x' })

		await lane_overrun.investigate(ISSUE)

		expect(mocks.launch).not.toHaveBeenCalled()
		expect(notes()).toStrictEqual([`#${String(ISSUE)} overran: 41 min net — not investigated: x`])
	})
})
