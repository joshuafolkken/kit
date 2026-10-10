import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_liveness } from '#scripts/run/run-liveness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake, type RunWake } from './run-wake'
import { run_wake_describe, type WakeContext } from './run-wake-describe'

const INVOCATION = 'backlogrun #1 #2'
const WOKE_LINE = 'woke 2 session(s) across 3 cut(s)'
const AGENT_LINE = 'agent: anthropic working'
const BARE = 'backlogrun #1'

const CONTEXT: WakeContext = {
	carry_target: '/stub/carry.json',
	wake_target: '/stub/wake.json',
	log_target: '/stub/wake.log',
	event_target: '/stub/events.jsonl',
	worktree: '/stub/repo',
}

const WAKE: RunWake = {
	invocation: INVOCATION,
	started_at: '2026-10-03T00:00:00.000Z',
	pid: 4242,
	woke: 2,
}

const CARRY = {
	invocation: WAKE.invocation,
	started_at: WAKE.started_at,
	merged: 0,
	filed: 0,
	cuts: 3,
	failures: 0,
	outages: 0,
}

const EVENT = { pos: 7, at: '2026-10-03T01:00:00.000Z', kind: 'merged', text: '#1 merged' }
const REPO = 'owner/repo'
const LINE_COUNT_WITHOUT_OPTIONALS = 7
const WATCH_LINE =
	'watch: `pnpm josh run:board` in a pane of its own (recover with `tail -F /stub/events.jsonl`)'

const live_spy = vi.spyOn(run_wake, 'is_supervisor_live')
const carry_spy = vi.spyOn(run_carry, 'read_carry')
const event_spy = vi.spyOn(run_event_stream, 'read_last')
const agent_spy = vi.spyOn(run_liveness, 'describe_agent_state')
const repo_spy = vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within')
const owner_spy = vi.spyOn(run_carry, 'is_owner_live')

beforeEach(() => {
	owner_spy.mockReset().mockReturnValue(false)
	live_spy.mockReset().mockReturnValue(true)
	carry_spy.mockReset().mockReturnValue({ kind: 'carried', carry: CARRY })
	event_spy.mockReset().mockReturnValue(undefined)
	agent_spy.mockReset().mockReturnValue(undefined)
	repo_spy.mockReset().mockReturnValue(undefined)
})

function lines(wake: RunWake = WAKE): Array<string> {
	return run_wake_describe.describe_wake(wake, CONTEXT).split('\n')
}

describe('run_wake_describe.describe_wake — the always-present lines', () => {
	it('prints the invocation, supervisor, counts, output, watch and stop lines in order', () => {
		expect(lines()).toStrictEqual([
			`invocation: ${INVOCATION}`,
			'profile: unrecorded',
			'supervisor: process 4242 (running), watching since 2026-10-03T00:00:00.000Z',
			WOKE_LINE,
			'output: /stub/wake.log',
			WATCH_LINE,
			'stop it with `pnpm josh run:wake --stop`',
		])
	})

	it('says not running when the supervisor process is gone', () => {
		live_spy.mockReturnValue(false)

		expect(lines()[2]).toBe(
			'supervisor: process 4242 (not running), watching since 2026-10-03T00:00:00.000Z',
		)
	})

	it('describes a recorded profile', () => {
		const profile: AgentProfile = {
			provider: 'anthropic',
			role: 'scheduler',
			model: 'opus',
			effort: 'medium',
		}

		expect(lines({ ...WAKE, profile })[1]).toBe(
			'profile: provider=anthropic role=scheduler model=opus effort=medium',
		)
	})
})

describe('run_wake_describe.describe_wake — the cut count read from the carry record', () => {
	it('reads the cuts of an expired carry record too', () => {
		carry_spy.mockReturnValue({ kind: 'expired', carry: CARRY })

		expect(lines()[3]).toBe(WOKE_LINE)
	})

	it.each([{ kind: 'none' as const }, { kind: 'unreadable' as const }])(
		'says the count is unreadable when the carry record is $kind',
		(read) => {
			carry_spy.mockReturnValue(read)

			expect(lines()[3]).toBe('woke 2 session(s) across an unreadable number of cut(s)')
		},
	)
})

describe('run_wake_describe.describe_wake — the optional lines', () => {
	it('adds the outstanding-launch line only while attempts is recorded', () => {
		expect(lines()).toHaveLength(LINE_COUNT_WITHOUT_OPTIONALS)
		expect(lines({ ...WAKE, attempts: 2 })[4]).toBe(
			'2 launch(es) outstanding for the current cut, none claimed yet',
		)
	})

	it('adds the agent state line from the log target', () => {
		agent_spy.mockReturnValue(AGENT_LINE)

		expect(lines()[4]).toBe(AGENT_LINE)
		expect(agent_spy).toHaveBeenCalledWith(CONTEXT.log_target)
	})

	it('relays the newest event and names the board pane to watch on in', () => {
		event_spy.mockReturnValue(EVENT)

		expect(lines().slice(5, 7)).toStrictEqual([
			`progress: ${run_event_stream.format_event(EVENT)}`,
			WATCH_LINE,
		])
		expect(event_spy).toHaveBeenCalledWith(CONTEXT.event_target)
	})
})

// joshuafolkken/kit#3363: a waiting supervisor writes nothing to its log, so `--list` is where the
// reason and the time the wait ends have to be read.
const NOW = new Date('2026-10-03T02:00:00.000Z')
const HANDED_OFF = { ...CARRY, is_handed_off: true }

function wait_line(wake: RunWake): string | undefined {
	return run_wake_describe
		.describe_wake(wake, CONTEXT, NOW)
		.split('\n')
		.find((line) => line.startsWith('waiting: '))
}

function at(offset_ms: number): string {
	return new Date(NOW.getTime() + offset_ms).toISOString()
}

describe('run_wake_describe.describe_wake — the wait line on a handed-off record', () => {
	it('prints no wait line when the next pass would start the driver', () => {
		carry_spy.mockReturnValue({ kind: 'carried', carry: HANDED_OFF })

		expect(wait_line(WAKE)).toBeUndefined()
	})

	it('names the deadline a woken session has to claim the record by', () => {
		carry_spy.mockReturnValue({ kind: 'carried', carry: HANDED_OFF })

		expect(wait_line({ ...WAKE, woke_at: NOW.toISOString(), attempts: 1 })).toBe(
			`waiting: the woken session has until ${at(run_wake.WAKE_GRACE_MS)} to claim the carry record`,
		)
	})

	it('names the time an idle stretch starts the driver anyway', () => {
		carry_spy.mockReturnValue({ kind: 'carried', carry: HANDED_OFF })

		expect(wait_line({ ...WAKE, idle_since: NOW.toISOString() })).toBe(
			`waiting: no runnable work; the driver starts anyway at ${at(run_wake.IDLE_CEILING_MS)}`,
		)
	})
})

describe('run_wake_describe.describe_wake — the wait line on a live owner', () => {
	it('names the live session that holds the record and the record expiry', () => {
		owner_spy.mockReturnValue(true)
		carry_spy.mockReturnValue({ kind: 'carried', carry: { ...CARRY, owner_pid: 999 } })
		const expiry = new Date(Date.parse(CARRY.started_at) + run_carry.CARRY_MAX_AGE_MS).toISOString()

		expect(wait_line(WAKE)).toBe(
			`waiting: process 999 holds the carry record; the driver starts at its next cut or once it exits, and the record expires at ${expiry}`,
		)
	})

	it('says the driver is at work when the supervisor itself holds the record', () => {
		owner_spy.mockReturnValue(true)
		carry_spy.mockReturnValue({ kind: 'carried', carry: { ...CARRY, owner_pid: WAKE.pid } })

		expect(wait_line(WAKE)).toBe('waiting: the driver holds the carry record and is running')
	})
})

describe('run_wake_describe — citing issues in the description', () => {
	it('cite_description leaves the text untouched without a repository', () => {
		expect(run_wake_describe.cite_description(BARE, undefined)).toBe(BARE)
	})

	it('cite_description number-links every bare issue reference', () => {
		const cited = run_wake_describe.cite_description(INVOCATION, REPO)

		expect(cited).toContain('[#1](')
		expect(cited).toContain('[#2](')
	})

	it('describe_wake_cited links the description when the repository answers', () => {
		repo_spy.mockReturnValue(REPO)

		expect(run_wake_describe.describe_wake_cited(WAKE, CONTEXT)).toBe(
			run_wake_describe.cite_description(run_wake_describe.describe_wake(WAKE, CONTEXT), REPO),
		)
	})

	it('describe_wake_cited prints the bare description when the lookup does not answer', () => {
		expect(run_wake_describe.describe_wake_cited(WAKE, CONTEXT)).toBe(
			run_wake_describe.describe_wake(WAKE, CONTEXT),
		)
	})

	it('pins the stop command', () => {
		expect(run_wake_describe.STOP_COMMAND).toBe('pnpm josh run:wake --stop')
	})
})
