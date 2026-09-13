import os from 'node:os'
import path from 'node:path'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_liveness } from '#scripts/run/run-liveness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch, type DispatchOutcome } from './lane-dispatch'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'

// **The launch and the lane lookup are spied on, not reimplemented.** What this file pins is the
// request the dispatch composes — which directory the child runs in, which file it writes to, and that
// the invocation is `fullrun #<N>` rather than anything a caller handed in. That the request then
// starts a real detached process is `run-wake-session.test.ts`'s, which spawns one
// (joshuafolkken/kit#1749).

const ISSUE = '1749'
const LANE_DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-lane`)
// What the older flow recorded in a lane: the unit's own transcript, a file to read rather than write.
const RECORDED_TRANSCRIPT = path.join(os.tmpdir(), 'josh-test-session.jsonl')
const ALIVE_PROCESS = '--process alive'
const LAUNCH_FAILURE = 'spawn claude ENOENT'
const LOG_REFUSED = 'the session log at /x could not be opened'
const PID = 4242

const launch = vi.spyOn(detached_launch, 'launch')
const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const record_output = vi.spyOn(lane_output, 'record_output')

function lane(output: string | undefined): LaneInfo {
	return {
		issue: ISSUE,
		branch: `${ISSUE}-lane`,
		directory: LANE_DIRECTORY,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output,
		is_stranded: false,
	}
}

const DERIVED_LOG = lane_dispatch.default_log_path(lane(undefined))

beforeEach(() => {
	vi.clearAllMocks()
	launch.mockReturnValue({ kind: 'launched', pid: PID })
	find_open_lane.mockResolvedValue(lane(undefined))
	record_output.mockResolvedValue({
		kind: 'recorded',
		lane: lane(DERIVED_LOG),
		output: DERIVED_LOG,
	})
})

describe('lane_dispatch.child_invocation — what the child is asked to do', () => {
	it('asks for `fullrun #<N>` and nothing else', () => {
		expect(lane_dispatch.child_invocation(ISSUE)).toBe(`fullrun #${ISSUE}`)
	})

	it('refuses anything that is not an issue number, before it reaches a command line', () => {
		expect(() => lane_dispatch.child_invocation('1749; rm -rf /')).toThrow()
		expect(() => lane_dispatch.child_invocation('')).toThrow()
	})
})

describe('lane_dispatch.default_log_path — the log the dispatch owns', () => {
	it('is a path `run:liveness` can read, so the record is never one it refuses', () => {
		expect(run_liveness.to_safe_path(DERIVED_LOG)).toBeDefined()
	})

	it('is in the temp directory, so it survives `lane:close`', () => {
		expect(DERIVED_LOG.startsWith(os.tmpdir())).toBe(true)
	})

	it('names the issue, so a person can find the file by eye', () => {
		expect(DERIVED_LOG).toContain(ISSUE)
	})

	it('differs between two lanes sharing an issue number across repositories', () => {
		const elsewhere = { ...lane(undefined), directory: `${LANE_DIRECTORY}-other-repository` }

		expect(lane_dispatch.default_log_path(elsewhere)).not.toBe(DERIVED_LOG)
	})
})

describe('lane_dispatch.dispatch_child — the request the lane gets', () => {
	it('starts the agent CLI headless in the lane’s own work tree, writing to its own log', async () => {
		await lane_dispatch.dispatch_child(ISSUE)

		expect(launch.mock.calls[0]?.[0]).toStrictEqual({
			argv: { command: 'claude', args: ['-p', `fullrun #${ISSUE}`] },
			cwd: LANE_DIRECTORY,
			log_path: DERIVED_LOG,
			env: { [lane_child_marker.KEY]: ISSUE },
		})
	})

	// **The mark is what tells the child it was dispatched rather than typed** (joshuafolkken/kit#1904),
	// so the pre-gate cut fires from the environment instead of the model's reading of its own prompt.
	it('marks the child as dispatched for this issue', async () => {
		await lane_dispatch.dispatch_child(ISSUE)

		expect(launch.mock.calls[0]?.[0].env).toStrictEqual({ [lane_child_marker.KEY]: ISSUE })
	})

	it('records the path it writes to, so an unrecorded lane is not a reachable state', async () => {
		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(record_output).toHaveBeenCalledWith(ISSUE, DERIVED_LOG)
		expect(outcome.kind === 'dispatched' && outcome.log_path).toBe(DERIVED_LOG)
	})

	it('never appends into a path the lane already recorded, which may be a transcript to read', async () => {
		find_open_lane.mockResolvedValue(lane(RECORDED_TRANSCRIPT))

		await lane_dispatch.dispatch_child(ISSUE)

		expect(record_output).toHaveBeenCalledWith(ISSUE, DERIVED_LOG)
		expect(launch.mock.calls[0]?.[0].log_path).toBe(DERIVED_LOG)
	})
})

describe('lane_dispatch.dispatch_child — when it starts nothing', () => {
	it('starts nothing when no lane is open for the child', async () => {
		find_open_lane.mockResolvedValue(undefined)

		expect(await lane_dispatch.dispatch_child(ISSUE)).toStrictEqual({ kind: 'no-lane' })
		expect(launch).not.toHaveBeenCalled()
	})

	it('starts nothing when the path could not be recorded', async () => {
		record_output.mockResolvedValue({ kind: 'invalid', reason: 'the path cannot hold a quote' })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('unrecordable')
		expect(launch).not.toHaveBeenCalled()
	})

	it('reports a failed launch rather than leaving it silent', async () => {
		launch.mockReturnValue({ kind: 'failed', note: LAUNCH_FAILURE })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)
		const message = lane_dispatch.describe(outcome, ISSUE)

		expect(outcome.kind).toBe('failed')
		expect(message).toContain(LAUNCH_FAILURE)
		expect(message).toContain(DERIVED_LOG)
	})
})

// The launcher starts the child anyway when it cannot open the log, discarding its output. Reported as
// a plain success, the operator polls a file that never grows and books a working child as stopped.
describe('lane_dispatch — a child that started with nowhere to write', () => {
	beforeEach(() => {
		launch.mockImplementation((_request, on_error) => {
			on_error(LOG_REFUSED)

			return { kind: 'launched', pid: PID }
		})
	})

	it('is still a dispatch, because the child really is running', async () => {
		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('dispatched')
		expect(outcome.kind === 'dispatched' && outcome.notes).toStrictEqual([LOG_REFUSED])
	})

	it('says the output is not being kept rather than naming a file that will not grow', async () => {
		const message = lane_dispatch.describe(await lane_dispatch.dispatch_child(ISSUE), ISSUE)

		expect(message).toContain('NOT being kept')
		expect(message).toContain(LOG_REFUSED)
	})

	it('is warned about, unlike an ordinary dispatch', async () => {
		expect(lane_dispatch.is_worth_warning(await lane_dispatch.dispatch_child(ISSUE))).toBe(true)
	})
})

describe('lane_dispatch.is_worth_warning — what nobody would otherwise hear about', () => {
	it('says nothing about a dispatch that went entirely to plan', async () => {
		expect(lane_dispatch.is_worth_warning(await lane_dispatch.dispatch_child(ISSUE))).toBe(false)
	})

	it('warns on every refusal', () => {
		expect(lane_dispatch.is_worth_warning({ kind: 'no-lane' })).toBe(true)
		expect(lane_dispatch.is_worth_warning({ kind: 'unrecordable', reason: 'x' })).toBe(true)
	})
})

describe('lane_dispatch.describe — what a reader is told to do next', () => {
	const no_lane: DispatchOutcome = { kind: 'no-lane' }

	it('names `lane:open` when there is no lane to dispatch into', () => {
		expect(lane_dispatch.describe(no_lane, ISSUE)).toContain(`pnpm josh lane:open ${ISSUE}`)
	})

	it('sends the caller to the process trace, because a frozen log no longer means dead', async () => {
		const message = lane_dispatch.describe(await lane_dispatch.dispatch_child(ISSUE), ISSUE)

		expect(message).toContain(`pgrep -laf ${LANE_DIRECTORY}`)
		expect(message).toContain(ALIVE_PROCESS)
	})

	it('never throws, so a warning cannot lose the message it exists to carry', async () => {
		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(() => lane_dispatch.describe(outcome, 'not-a-number')).not.toThrow()
	})
})
