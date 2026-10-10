import type { IssueState } from '#scripts/issue/issue-state'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_prep, type PrepParts } from './run-prep'
import { run_step } from './run-step'

const parse_number_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
const to_parts_mock = vi.hoisted(() => vi.fn())
const repo_directory_mock = vi.hoisted(() => vi.fn())
const read_carry_mock = vi.hoisted(() => vi.fn())
const read_events_mock = vi.hoisted(() => vi.fn())
const cut_cap_mock = vi.hoisted(() => vi.fn(() => false))
// The session's own process ancestry, which a handed-off record's owner is checked against.
const ancestry_mock = vi.hoisted(() => vi.fn((): ReadonlySet<number> => new Set()))
const lane_child_mock = vi.hoisted(() => vi.fn(() => false))
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())
// Hoisted so the mock's EVENT_KIND and the stale-event regression test name the one kind once
// (joshuafolkken/kit#2395).
const STALE_KIND = vi.hoisted(() => 'child-launch')
const TRACE_KIND = vi.hoisted(() => 'ship-stage')

vi.mock('./run-prep-cli', () => ({
	run_prep_cli: { parse_number: parse_number_mock, gather: gather_mock, to_parts: to_parts_mock },
}))

vi.mock('#scripts/run/carry/run-carry', () => ({
	run_carry: {
		repository_directory: repo_directory_mock,
		read_carry: read_carry_mock,
		carry_path: (directory: string) => `${directory}/carry`,
		retrospective_done_of: (read: { carry?: { retrospective?: boolean } }) =>
			read.carry?.retrospective === true,
		is_at_cut_cap: cut_cap_mock,
	},
}))

vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { own_ancestry: ancestry_mock } }))
// Mocked so a test run from inside a lane worktree does not read itself as a lane child.
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: lane_child_mock, marked_issue: () => undefined },
}))

vi.mock('#scripts/run/event/run-event-stream', () => ({
	run_event_stream: {
		EVENT_KIND: {
			PLAN: 'plan',
			CHILD_LAUNCH: STALE_KIND,
			MERGE: 'merge',
			PARK: 'park',
			OUTAGE: 'outage',
			CUT: 'cut',
			STOP: 'stop',
			PR_OPENED: 'pr-opened',
			REVIEW_ROUND: 'review-round',
			SHIP_STAGE: TRACE_KIND,
			SHIP_LAUNCH: 'ship-launch',
			SHIP_STOP: 'ship-stop',
		},
		target_of: (directory: string) => `${directory}/events`,
		read_events: read_events_mock,
		TRACE_KINDS: new Set([TRACE_KIND]),
	},
}))

// `run-event-scope.ts` is left real — it is a pure function of the carry read and the events, reading
// only types and the trace-kind set from the mocked modules (joshuafolkken/kit#2395), so the CLI scopes the mocked stream exactly
// as it would a live one.

const { run_step_cli } = await import('./run-step-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '2248'
const OPEN_STATE: IssueState = { state: 'OPEN', labels: [], is_human_review: false }
// The invocation this run belongs to, and a moment before it that a previous invocation's events carry.
const RUN_START = '2026-09-21T00:00:00.000Z'
const BEFORE_RUN = '2026-09-19T18:00:00.000Z'
const CARRIED = 'carried'

interface CarriedRead {
	kind: typeof CARRIED
	carry: { started_at: string }
}

interface StreamEvent {
	pos: number
	at: string
	kind: string
	text: string
}

function carried(started_at: string = RUN_START): CarriedRead {
	return { kind: CARRIED, carry: { started_at } }
}

function stream_event(kind: string, at: string): StreamEvent {
	return { pos: 1, at, kind, text: '' }
}

function parts(overrides: Partial<PrepParts>): PrepParts {
	return {
		issue_number: ISSUE,
		content_body: 'body',
		state: OPEN_STATE,
		state_failure: '',
		latest_scope: 'skip',
		latest_reason: 'window is 12h',
		has_changes: false,
		locations: '',
		ship_problems: [],
		...overrides,
	}
}

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	const mocks = [
		parse_number_mock,
		gather_mock,
		to_parts_mock,
		repo_directory_mock,
		read_carry_mock,
		read_events_mock,
		info_mock,
		error_mock,
	]

	for (const mock of mocks) mock.mockReset()
	parse_number_mock.mockReturnValue(ISSUE)
	gather_mock.mockResolvedValue({})
	to_parts_mock.mockReturnValue(parts({}))
	repo_directory_mock.mockResolvedValue('/repo')
	read_carry_mock.mockReturnValue({ kind: 'none' })
	read_events_mock.mockReturnValue([])
})

// A gate run inside a headless lane inherits the mark, which exempts the cut cap.
beforeEach(() => {
	vi.stubEnv('JOSH_RUN_HEADLESS', '')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('run_step_cli.run', () => {
	it('prints the implement verdict for an open issue with an empty stream and exits zero', async () => {
		expect(await run_step_cli.run([ISSUE])).toBe(SUCCESS)
		expect(printed()).toBe(run_step.IMPLEMENT)
	})

	it('reads its issue facts through run:prep’s own gather', async () => {
		await run_step_cli.run([ISSUE])

		expect(gather_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('dispatches to followup when the newest event is a PR opening', async () => {
		read_carry_mock.mockReturnValue(carried())
		read_events_mock.mockReturnValue([stream_event('pr-opened', RUN_START)])

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe('pnpm josh followup')
	})

	it('answers unknown when the carry record is unreadable', async () => {
		read_carry_mock.mockReturnValue({ kind: 'unreadable' })

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.UNKNOWN)
	})

	it('exits non-zero when the issue state could not be read', async () => {
		to_parts_mock.mockReturnValue(parts({ state: undefined }))

		expect(await run_step_cli.run([ISSUE])).toBe(FAILURE)
		expect(printed()).toBe(run_step.UNKNOWN)
	})

	it('refuses a missing issue number', async () => {
		parse_number_mock.mockReturnValue(undefined)

		expect(await run_step_cli.run([])).toBe(FAILURE)
		expect(gather_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3154: what `josh ship` would refuse on is said at every step, on stderr, so the
// one-line action on stdout is unchanged.
describe('run_step_cli.run — the ship preconditions', () => {
	const evidence_problem =
		'This change touches runtime code, but the PR body has no ## 実機証跡 section'

	it('reports an unmet precondition on stderr and keeps stdout the action line', async () => {
		to_parts_mock.mockReturnValue(parts({ ship_problems: [evidence_problem] }))

		await run_step_cli.run([ISSUE])

		const reported = error_mock.mock.calls.map((call) => String(call[0])).join('\n')

		expect(printed()).toBe(run_step.IMPLEMENT)
		expect(reported).toContain(run_prep.SHIP_UNMET)
		expect(reported).toContain(evidence_problem)
	})

	it('reports nothing when every precondition is met', async () => {
		await run_step_cli.run([ISSUE])

		expect(error_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2653: the completion callback is read off the session's own environment.
function stub_session(key: string): void {
	for (const parent_key of agent_session_environment.PARENT_SESSION_KEYS) {
		vi.stubEnv(parent_key, '')
	}

	vi.stubEnv('CODEX_THREAD_ID', '')
	vi.stubEnv(key, 'session')
}

describe('run_step_cli.run — the completion callback', () => {
	it.each([
		['CODEX_THREAD_ID', run_step.HAND_OFF_COMMAND],
		['CLAUDE_CODE_SESSION_ID', run_step.WAIT],
	])('answers a %s parent that launched a child with %s', async (key, line) => {
		stub_session(key)
		read_carry_mock.mockReturnValue(carried())
		read_events_mock.mockReturnValue([stream_event(STALE_KIND, RUN_START)])

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(line)
	})

	it('keeps a Codex parent at the cut cap waiting rather than printing a refused cut', async () => {
		stub_session('CODEX_THREAD_ID')
		cut_cap_mock.mockReturnValueOnce(true)
		read_carry_mock.mockReturnValue(carried())
		read_events_mock.mockReturnValue([stream_event(STALE_KIND, RUN_START)])

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.WAIT)
	})
})

// joshuafolkken/kit#2395: the observed defect. A previous invocation's `child-launch` was still the
// stream's tail on a fresh run, so `run:step` printed `wait` instead of the pre-implementation verdict.
// Scoping the read to this invocation's start drops that stale event, so the position is read correctly.
describe('run_step_cli.run — the invocation scope of the position', () => {
	it('does not read a stale event from before the run began as the position', async () => {
		read_carry_mock.mockReturnValue(carried())
		read_events_mock.mockReturnValue([stream_event(STALE_KIND, BEFORE_RUN)])

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.IMPLEMENT)
	})

	// An undetermined scope (here a `none` carry over a populated stream) must not round back to the whole
	// stream: the newest event is not read as the position, so the run falls to pre-implementation rather
	// than following a stream it cannot attribute to this invocation.
	it('does not follow the stream when the scope cannot be determined', async () => {
		read_carry_mock.mockReturnValue({ kind: 'none' })
		read_events_mock.mockReturnValue([stream_event('pr-opened', RUN_START)])

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.IMPLEMENT)
	})

	// joshuafolkken/kit#2428: the detached ship supervisor's stop names its issue, so it is this run's
	// position even with no carry scope — and another issue's is not.
	it('reads its own ship supervisor’s stop as the position without a carry scope', async () => {
		read_carry_mock.mockReturnValue({ kind: 'none' })
		read_events_mock.mockReturnValue([
			{ pos: 1, at: RUN_START, kind: 'ship-stop', text: `#${ISSUE} gate failed` },
			{ pos: 2, at: RUN_START, kind: 'ship-stop', text: '#99 gate failed' },
		])

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(`pnpm josh ship --log ${ISSUE}`)
	})

	// joshuafolkken/kit#3039: another lane's merge under the batch's carry scope was read as a planned lane
	// child's position, so `run:step` told it to stop while `run:entry` / `run:next` said implement.
	it('answers implement to a lane child whose stream ends in another issue’s merge', async () => {
		lane_child_mock.mockReturnValueOnce(true)
		read_carry_mock.mockReturnValue(carried())
		read_events_mock.mockReturnValue([
			{ pos: 1, at: RUN_START, kind: 'plan', text: `planned #${ISSUE}` },
			{ pos: 2, at: RUN_START, kind: 'merge', text: '#3027 merged' },
		])

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.IMPLEMENT)
	})
})

// joshuafolkken/kit#2370: the retrospective is opt-in, so the same stop position prints the
// retrospective command only when `JOSH_RETROSPECTIVE` is set to an enabling value.
describe('run_step_cli.run — the JOSH_RETROSPECTIVE switch', () => {
	beforeEach(() => {
		read_carry_mock.mockReturnValue(carried())
		read_events_mock.mockReturnValue([stream_event('stop', RUN_START)])
	})

	afterEach(() => {
		delete process.env['JOSH_RETROSPECTIVE']
	})

	it('stops with no command at a stop when the switch is unset', async () => {
		delete process.env['JOSH_RETROSPECTIVE']

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.STOP)
	})

	it('dispatches the retrospective at a stop when the switch is enabled', async () => {
		process.env['JOSH_RETROSPECTIVE'] = 'on'

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.RETROSPECTIVE_COMMAND)
	})
})

describe('run_step_cli.run — a handed-off carry record', () => {
	const OWNER_PID = 4242
	const OTHER_PID = 5151

	function hand_off(): void {
		read_carry_mock.mockReturnValue({
			kind: CARRIED,
			carry: { started_at: RUN_START, is_handed_off: true, owner_pid: OWNER_PID },
		})
		read_events_mock.mockReturnValue([stream_event('merge', RUN_START)])
	}

	// joshuafolkken/kit#2760: the hand-off mark is read off the record, so the session that took the cut
	// is told to stop rather than pointed at the next child.
	it('stops the session that declared the handed-off record', async () => {
		hand_off()
		ancestry_mock.mockReturnValue(new Set([OTHER_PID, OWNER_PID]))

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.STOP)
	})

	// A `fullrun #M` started in another conversation shares the repository's record, but is not its owner,
	// so the parent's hand-off must not stop it.
	it('does not stop a session that is not the record’s owner', async () => {
		hand_off()
		ancestry_mock.mockReturnValue(new Set([OTHER_PID]))

		await run_step_cli.run([ISSUE])

		expect(printed()).not.toBe(run_step.STOP)
	})
})
