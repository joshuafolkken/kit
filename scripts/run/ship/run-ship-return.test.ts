import { beforeEach, describe, expect, it, vi } from 'vitest'

const emit_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
const find_lane_mock = vi.hoisted(() => vi.fn())
const relaunch_mock = vi.hoisted(() => vi.fn())
const serving_mock = vi.hoisted(() => vi.fn())
const request_mock = vi.hoisted(() => vi.fn())
const is_over_mock = vi.hoisted(() => vi.fn())
const stale_mock = vi.hoisted(() => vi.fn())
const CHANGED_FILE = vi.hoisted(() => 'scripts/changed.ts')

// The lane-place wait is covered in `run-ship-return-waiter.test.ts`.
vi.mock('./run-ship-place', () => ({ run_ship_place: { await_place: vi.fn() } }))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: find_lane_mock },
}))
vi.mock('#scripts/lane/lane-relaunch', () => ({ lane_relaunch: { relaunch: relaunch_mock } }))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: {
		serving_session: serving_mock,
		request: request_mock,
		is_unreadable: (answer: { reason?: string }): boolean =>
			answer.reason?.includes('could not read the request') === true,
	},
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async (): Promise<Array<string>> => [CHANGED_FILE] },
}))

vi.mock('node:timers/promises', () => ({ setTimeout: async (): Promise<void> => undefined }))

// No session waits on the ship here: `run-ship-return-waiter.test.ts` covers the one that does.
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: { read_review_stale: stale_mock, repository_directory: vi.fn() },
}))
vi.mock('./run-ship-relaunch-cap', () => ({
	run_ship_relaunch_cap: { is_over: is_over_mock },
}))

const { run_ship_return } = await import('./run-ship-return')

// joshuafolkken/kit#2428: a detached supervisor that stops has nobody reading its report, so it records
// the stop as a position and — in a dispatched Anthropic lane — relaunches a child to fix it.

const ISSUE = '2428'
const TITLE = `Hand a stopped ship back #${ISSUE}`
const BODY_PATH = 'scratchpad/evidence.md'
const RESUME = { title: TITLE, flags: ['--body-file', BODY_PATH], is_review: true }
const LANE = { issue: ISSUE, directory: '/lanes/2428', profile: undefined }
const OUTPUT = 'FAIL scripts/run/ship/run-ship.test.ts'
const CONTEXT = { excerpt: [OUTPUT], changed: [CHANGED_FILE], more_changed: 0 }
const ARGS = {
	number: ISSUE,
	title: TITLE,
	notify: [],
	body: [],
	body_path: undefined,
	cites: [],
	is_review: true,
	is_detach: true,
	unpinned_ok: [],
}
const SERVER = 'server-1'
const NEW_SERVER = 'server-2'
const STOPPED = { is_success: false, reason: 'the broker stopped serving before it answered' }

beforeEach(() => {
	emit_mock.mockReset()
	is_child_mock.mockReset().mockReturnValue(true)
	find_lane_mock.mockReset().mockResolvedValue(LANE)
	relaunch_mock.mockReset().mockResolvedValue({ kind: 'launched', pid: 1 })
	serving_mock.mockReset().mockReturnValue(undefined)
	request_mock.mockReset().mockResolvedValue({ is_success: true })
	is_over_mock.mockReset().mockResolvedValue(false)
	stale_mock.mockReset().mockResolvedValue(false)
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('run_ship_return.return_control', () => {
	it('records the stopped stage as a ship-stop position naming the issue', async () => {
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)

		expect(emit_mock).toHaveBeenCalledWith(
			'ship-stop',
			`#${ISSUE} gate failed (check) — pnpm josh ship --log ${ISSUE}`,
		)
	})

	it('relaunches the lane child with the ship-stop prompt at the implementation phase', async () => {
		expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe('relaunched')

		const [lane, invocation, phase] = (relaunch_mock.mock.calls[0] ?? []) as ReadonlyArray<unknown>

		expect(lane).toBe(LANE)
		expect(String(invocation)).toContain('ship supervisor stopped')
		expect(String(invocation)).toContain(`--body-file ${BODY_PATH} '${TITLE}'`)
		expect(String(invocation).endsWith(`fullrun #${ISSUE}`)).toBe(true)
		expect(phase).toBe('implementation')
	})

	it('relaunches nothing outside a dispatched lane child', async () => {
		is_child_mock.mockReturnValue(false)

		expect(await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)).toBe('recorded')
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('leaves an OpenAI lane to its own supervisor', async () => {
		find_lane_mock.mockResolvedValue({ ...LANE, profile: { provider: 'openai' } })

		expect(await run_ship_return.return_control(ISSUE, 'followup', RESUME, OUTPUT)).toBe('recorded')
		expect(relaunch_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4765: a relaunch that started nothing was written only to the ship log, and the dispatch
// log's header — written before the spawn — made its mtime read the stop as answered.
describe('run_ship_return.return_control when no relaunch started', () => {
	const RELAUNCH_FAILED = 'relaunch-failed'

	it('records the stop and the failed relaunch when the relaunch could not start', async () => {
		relaunch_mock.mockResolvedValue({ kind: 'failed', note: 'no claude' })

		expect(await run_ship_return.return_control(ISSUE, 'commit', RESUME, OUTPUT)).toBe('recorded')
		expect(emit_mock).toHaveBeenCalledTimes(2)
		expect(emit_mock).toHaveBeenLastCalledWith(
			RELAUNCH_FAILED,
			`#${ISSUE} could not be relaunched: no claude`,
		)
	})

	it('records the re-dispatch with the broker reason for run:merge', async () => {
		serving_mock.mockReturnValue(SERVER)
		request_mock.mockResolvedValue({ is_success: false, reason: 'the broker refused it' })
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)

		expect(emit_mock).toHaveBeenLastCalledWith(
			RELAUNCH_FAILED,
			`#${ISSUE} could not be relaunched: the driver re-dispatches the issue — the broker refused it`,
		)
	})
})

// joshuafolkken/kit#4466: a ship waiting on its merge holds no lane place, so a red CI or a CodeRabbit
// finding that needs judgement must still bring a child back to fix it.
describe('run_ship_return.return_control on a merge wait that needs judgement', () => {
	it.each([
		['a red CI check', 'X e2e  fail  https://github.com/o/r/actions/runs/1'],
		['a CodeRabbit finding', 'CodeRabbit left 1 unresolved actionable comment'],
	])('relaunches the lane child with %s in its prompt', async (_case, output) => {
		expect(await run_ship_return.return_control(ISSUE, 'followup', RESUME, output)).toBe(
			'relaunched',
		)

		const invocation = String(relaunch_mock.mock.calls[0]?.[1])

		expect(invocation).toContain(output)
		expect(invocation.endsWith(`fullrun #${ISSUE}`)).toBe(true)
	})
})

// joshuafolkken/kit#3817: this supervisor descends from the child's Bash tool and so has no token; a lane
// the supervisor's broker serves is relaunched by that broker instead.
describe('run_ship_return.return_control on a served lane', () => {
	it('asks the broker to relaunch the child and starts none itself', async () => {
		serving_mock.mockReturnValue(SERVER)

		expect(await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)).toBe('relaunched')
		expect(request_mock).toHaveBeenCalledWith(LANE.directory, ISSUE, {
			kind: 'relaunch',
			stop: { stage: 'gate', ...RESUME, context: CONTEXT },
		})
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('asks the broker that failed the relaunch no more and hands the issue to the driver', async () => {
		serving_mock.mockReturnValue(SERVER)
		request_mock.mockResolvedValue({ is_success: false, reason: 'the relaunch did not start' })

		expect(await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)).toBe('redispatch')
		expect(request_mock).toHaveBeenCalledTimes(1)
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#3974: the ship log said only that the broker did not start the child.
	it("writes the broker's reason to the ship log", async () => {
		const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		serving_mock.mockReturnValue(SERVER)
		request_mock.mockResolvedValue({ is_success: false, reason: 'the issue is parked' })
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)

		expect(write).toHaveBeenCalledWith(expect.stringContaining('— the issue is parked'))
	})
})

// joshuafolkken/kit#4344: a relaunch the broker failed left the lane idle until the stall detector.
describe('run_ship_return.return_control when the broker fails the relaunch', () => {
	const SILENT = { is_success: false, reason: 'the broker gave no answer within 2 minutes' }
	const FAILURES = [
		['stopped serving', STOPPED],
		['gave no answer', SILENT],
	] as const

	it.each(FAILURES)(
		'asks a new broker once more and relaunches when one %s',
		async (_label, failed) => {
			serving_mock
				.mockReturnValueOnce(SERVER)
				.mockReturnValueOnce(SERVER)
				.mockReturnValue(NEW_SERVER)
			request_mock.mockResolvedValueOnce(failed).mockResolvedValue({ is_success: true })

			expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe(
				'relaunched',
			)
			expect(request_mock).toHaveBeenCalledTimes(2)
		},
	)

	it.each(FAILURES)(
		'hands the issue to the driver when the new broker also %s',
		async (_label, failed) => {
			serving_mock.mockReturnValueOnce(SERVER).mockReturnValue(NEW_SERVER)
			request_mock.mockResolvedValue(failed)

			expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe(
				'redispatch',
			)
			expect(request_mock).toHaveBeenCalledTimes(2)
			expect(relaunch_mock).not.toHaveBeenCalled()
		},
	)
})

// joshuafolkken/kit#4344: a broker that died during the review left the stop to a relaunch with no token.
describe('run_ship_return.return_control after the broker stopped serving', () => {
	it('asks no more of a broker that never serves the lane again', async () => {
		serving_mock.mockReturnValueOnce(SERVER).mockReturnValue(undefined)
		request_mock.mockResolvedValue(STOPPED)

		expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe('redispatch')
		expect(request_mock).toHaveBeenCalledTimes(1)
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('waits for a broker that stopped serving before the stop rather than relaunching', async () => {
		serving_mock.mockReturnValueOnce(undefined).mockReturnValue(SERVER)

		expect(await run_ship_return.return_control(ISSUE, 'review', RESUME, OUTPUT)).toBe('relaunched')
		expect(request_mock).toHaveBeenCalledTimes(1)
		expect(relaunch_mock).not.toHaveBeenCalled()
	})
})

// The ship-stop cap and the merge-wait timeout's park are covered in `run-ship-return-park.test.ts`.

// joshuafolkken/kit#3221: a stop on a merge git could not finish reads as `conflict`, not as the stage.
describe('run_ship_return.return_control on a merge conflict', () => {
	const conflicted = 'scripts/a.ts'

	it('records the stop as conflict and hands the files to the prompt', async () => {
		await run_ship_return.return_control(
			ISSUE,
			'followup',
			{ ...RESUME, conflicts: [conflicted] },
			OUTPUT,
		)

		expect(emit_mock).toHaveBeenCalledWith(
			'ship-stop',
			`#${ISSUE} conflict failed (conflict) — pnpm josh ship --log ${ISSUE}`,
		)
		expect(String(relaunch_mock.mock.calls[0]?.[1])).toContain(conflicted)
	})

	// joshuafolkken/kit#4707: a review-stage conflict counts against the mechanical cap.
	it('asks the cap for the conflict, not the stage', async () => {
		await run_ship_return.return_control(
			ISSUE,
			'review',
			{ ...RESUME, conflicts: [conflicted] },
			OUTPUT,
		)

		expect(is_over_mock).toHaveBeenCalledWith(ISSUE, 'conflict')
	})
})

// joshuafolkken/kit#3923: the failed output and the changed files ride in the prompt itself.
describe('run_ship_return — the stop context in the relaunched prompt', () => {
	const conflicted = 'scripts/conflicted.ts'

	it('puts the failed output and the changed files in the relaunched prompt', async () => {
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)

		const invocation = String(relaunch_mock.mock.calls[0]?.[1])

		expect(invocation).toContain(`\n${OUTPUT}\n`)
		expect(invocation).toContain(`Changed files on the branch: ${CHANGED_FILE}.`)
	})

	it('hands the failed section body and its conflicts to the relaunched prompt', async () => {
		const failed = { body: OUTPUT, conflicts: [conflicted] }

		expect(await run_ship_return.hand_back(ARGS, 'followup', failed)).toBe('relaunched')

		const invocation = String(relaunch_mock.mock.calls[0]?.[1])

		expect(invocation).toContain(conflicted)
		expect(invocation).toContain(OUTPUT)
	})

	// joshuafolkken/kit#4431: the ship-stop position names the cause the review round tagged.
	it('records a review stop under the cause its round tagged', async () => {
		await run_ship_return.hand_back(ARGS, 'review', { body: OUTPUT, cause: 'attest' })

		expect(emit_mock).toHaveBeenCalledWith(
			'ship-stop',
			`#${ISSUE} review failed (attest) — pnpm josh ship --log ${ISSUE}`,
		)
	})

	it('relaunches with no excerpt when no section failed', async () => {
		expect(await run_ship_return.hand_back(ARGS, 'gate', undefined)).toBe('relaunched')
		expect(String(relaunch_mock.mock.calls[0]?.[1])).toContain(`pnpm josh ship --log ${ISSUE}`)
	})

	// joshuafolkken/kit#4221: a followup refused on a stale review relaunches into a second review.
	it('carries a stale review onto the relaunch', async () => {
		stale_mock.mockResolvedValue(true)

		expect(await run_ship_return.hand_back(ARGS, 'followup', undefined)).toBe('relaunched')
		expect(String(relaunch_mock.mock.calls[0]?.[1])).toContain('pnpm josh ship --detach --review')
	})
})

// joshuafolkken/kit#4589: a failed section's body carries its stderr, where a poll warns of a rate
// limit it recovered from — the stop is classified on the standard output alone.
describe('run_ship_return.hand_back on a section that kept its standard output apart', () => {
	it('classifies a followup stop on the standard output, not its stderr', async () => {
		const failed = { body: `${OUTPUT}\nAPI rate limit exceeded`, out: OUTPUT }

		await run_ship_return.hand_back(ARGS, 'followup', failed)

		expect(emit_mock).toHaveBeenCalledWith(
			'ship-stop',
			`#${ISSUE} followup failed (check) — pnpm josh ship --log ${ISSUE}`,
		)
	})
})
