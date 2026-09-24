import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { claude_agent_argv } from '#scripts/agent/claude-agent-argv'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_dispatch, type DispatchOutcome } from './lane-dispatch'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'

// joshuafolkken/kit#1934: a backlogrun/epicrun parent must re-dispatch a child released from
// `needs-decision` to a lane rather than implement it in its own context. The path is already covered
// by two existing commands — `lane:open <N>` then `lane:dispatch <N>` — and neither reads the child's
// labels, so a released child flows through the identical sequence as a fresh one. This pins that
// contract: a released child is delegated as `fullrun #<N>` in its own lane, the invocation is
// label-independent, and with no lane open yet the guidance starts at `lane:open`. No new command is
// needed. The launch and lane lookup are spied on, as in lane-dispatch.test.ts — what is asserted is
// the request the re-dispatch composes, not that it spawns a real process.

// The child a parent implemented inline in the measured incident.
const RELEASED_CHILD = '1909'
const FRESH_CHILD = '1912'
const LANE_DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${RELEASED_CHILD}-lane`)
const PID = 909

const launch = vi.spyOn(detached_launch, 'launch')

// The CLI version probe is the diagnostics' own test; here it would depend on the machine's CLI.
vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const record_output = vi.spyOn(lane_output, 'record_output')
const add_label = vi.spyOn(git_gh_command, 'issue_add_label')

// A started child is recorded on the run's stream; that write is kept off the real repository's stream.
vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue(undefined)

function lane(): LaneInfo {
	return {
		issue: RELEASED_CHILD,
		branch: `${RELEASED_CHILD}-lane`,
		directory: LANE_DIRECTORY,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

const DERIVED_LOG = lane_dispatch.default_log_path(lane())

beforeEach(() => {
	vi.clearAllMocks()
	launch.mockReturnValue({ kind: 'launched', pid: PID })
	find_open_lane.mockResolvedValue(lane())
	record_output.mockResolvedValue({ kind: 'recorded', lane: lane(), output: DERIVED_LOG })
	add_label.mockResolvedValue(true)
})

describe('re-dispatching a released child to a lane (joshuafolkken/kit#1934)', () => {
	// Behavior 2: the released child is delegated, never implemented in the parent's context.
	it('delegates the released child as `fullrun #<N>` in the lane, not in the parent', async () => {
		const outcome = await lane_dispatch.dispatch_child(RELEASED_CHILD)
		// The lane child now launches with the explicit model and effort (joshuafolkken/kit#1932), so the
		// expected vector is derived from the launcher rather than spelled out with the flags inline.
		const built = claude_agent_argv.build(
			`fullrun #${RELEASED_CHILD}`,
			agent_role_profile.DEFAULT_PROFILES.worker,
			undefined,
			LANE_DIRECTORY,
		)

		expect(outcome.kind).toBe('dispatched')
		expect(launch.mock.calls[0]?.[0].argv).toStrictEqual(built)
		expect(launch.mock.calls[0]?.[0].cwd).toBe(LANE_DIRECTORY)
	})

	// The path is label-independent: dispatch composes the same invocation whatever the child's prior
	// parked state was, because neither `lane:open` nor `lane:dispatch` reads a label. So a parent has
	// no reason to treat a released child specially — which is the whole ground for not implementing it.
	it('composes the same delegated invocation as a fresh child', () => {
		expect(lane_dispatch.child_invocation(RELEASED_CHILD)).toBe(`fullrun #${RELEASED_CHILD}`)
		expect(lane_dispatch.child_invocation(FRESH_CHILD)).toBe(`fullrun #${FRESH_CHILD}`)
	})

	// The two-command re-dispatch path starts at `lane:open` when no lane is open yet.
	it('sends the parent to `lane:open` first when no lane is open for the released child', () => {
		const no_lane: DispatchOutcome = { kind: 'no-lane' }

		expect(lane_dispatch.describe(no_lane, RELEASED_CHILD)).toContain(
			`pnpm josh lane:open ${RELEASED_CHILD}`,
		)
	})
})

// joshuafolkken/kit#2317: an `outage` re-dispatch resumes the disconnected child's session rather than
// starting a fresh `fullrun`, recovering its context. The fresh path is already pinned by the suite
// above (no exit record is written, so it plans fresh); this writes an outage exit record into the
// lane's own log so the re-dispatch reads it and resumes.
describe('re-dispatching an outage child by resuming its session', () => {
	const SESSION = '1d34ae8b-6f89-44b7-9f0f-42a67c44e650'
	const OUTAGE_LINE = JSON.stringify({
		type: 'result',
		is_error: true,
		result: 'The socket connection was closed unexpectedly',
		session_id: SESSION,
	})

	function write_outage_log(): void {
		mkdirSync(path.dirname(DERIVED_LOG), { recursive: true })
		writeFileSync(DERIVED_LOG, `${OUTAGE_LINE}\n`, 'utf8')
	}

	afterEach(() => {
		rmSync(DERIVED_LOG, { force: true })
	})

	it('launches the resume argv carrying the stored session id', async () => {
		write_outage_log()
		await lane_dispatch.dispatch_child(RELEASED_CHILD)
		const resumed = claude_agent_argv.build_resume(
			lane_child_invocation.outage_resume_invocation(RELEASED_CHILD),
			agent_role_profile.DEFAULT_PROFILES.worker,
			SESSION,
			LANE_DIRECTORY,
		)

		expect(launch.mock.calls[0]?.[0].argv).toStrictEqual(resumed)
	})

	it('reports that the session was resumed', async () => {
		write_outage_log()
		const outcome = await lane_dispatch.dispatch_child(RELEASED_CHILD)

		expect(lane_dispatch.describe(outcome, RELEASED_CHILD)).toContain(`Resumed session ${SESSION}`)
	})
})
