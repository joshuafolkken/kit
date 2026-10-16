import { beforeEach, describe, expect, it, vi } from 'vitest'

const emit_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
const find_lane_mock = vi.hoisted(() => vi.fn())
const relaunch_mock = vi.hoisted(() => vi.fn())
const serving_mock = vi.hoisted(() => vi.fn())
const request_mock = vi.hoisted(() => vi.fn())
const CHANGED_FILE = vi.hoisted(() => 'scripts/changed.ts')

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
	lane_session_broker: { is_serving: serving_mock, request: request_mock },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async (): Promise<Array<string>> => [CHANGED_FILE] },
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

beforeEach(() => {
	emit_mock.mockReset()
	is_child_mock.mockReset().mockReturnValue(true)
	find_lane_mock.mockReset().mockResolvedValue(LANE)
	relaunch_mock.mockReset().mockReturnValue({ kind: 'launched', pid: 1 })
	serving_mock.mockReset().mockReturnValue(false)
	request_mock.mockReset().mockResolvedValue(true)
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('run_ship_return.return_control', () => {
	it('records the stopped stage as a ship-stop position naming the issue', async () => {
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)

		expect(emit_mock).toHaveBeenCalledWith(
			'ship-stop',
			`#${ISSUE} gate failed — pnpm josh ship --log ${ISSUE}`,
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

	it('still records the stop when the relaunch could not start', async () => {
		relaunch_mock.mockReturnValue({ kind: 'failed', note: 'no claude' })

		expect(await run_ship_return.return_control(ISSUE, 'commit', RESUME, OUTPUT)).toBe('recorded')
		expect(emit_mock).toHaveBeenCalledTimes(1)
	})
})

// joshuafolkken/kit#3817: this supervisor descends from the child's Bash tool and so has no token; a lane
// the supervisor's broker serves is relaunched by that broker instead.
describe('run_ship_return.return_control on a served lane', () => {
	it('asks the broker to relaunch the child and starts none itself', async () => {
		serving_mock.mockReturnValue(true)

		expect(await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)).toBe('relaunched')
		expect(request_mock).toHaveBeenCalledWith(LANE.directory, ISSUE, {
			kind: 'relaunch',
			stop: { stage: 'gate', ...RESUME, context: CONTEXT },
		})
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('records the stop when the broker could not relaunch the child', async () => {
		serving_mock.mockReturnValue(true)
		request_mock.mockResolvedValue(false)

		expect(await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)).toBe('recorded')
		expect(relaunch_mock).not.toHaveBeenCalled()
	})
})

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
			`#${ISSUE} conflict failed — pnpm josh ship --log ${ISSUE}`,
		)
		expect(String(relaunch_mock.mock.calls[0]?.[1])).toContain(conflicted)
	})
})

// joshuafolkken/kit#3923: the failed output and the changed files ride in the prompt itself.
describe('run_ship_return — the stop context in the relaunched prompt', () => {
	const conflicted = 'scripts/conflicted.ts'
	const args = {
		number: ISSUE,
		title: TITLE,
		notify: [],
		body: [],
		body_path: undefined,
		cites: [],
		is_review: true,
		is_detach: true,
	}

	it('puts the failed output and the changed files in the relaunched prompt', async () => {
		await run_ship_return.return_control(ISSUE, 'gate', RESUME, OUTPUT)

		const invocation = String(relaunch_mock.mock.calls[0]?.[1])

		expect(invocation).toContain(`\n${OUTPUT}\n`)
		expect(invocation).toContain(`Changed files on the branch: ${CHANGED_FILE}.`)
	})

	it('hands the failed section body and its conflicts to the relaunched prompt', async () => {
		const failed = { body: OUTPUT, conflicts: [conflicted] }

		expect(await run_ship_return.hand_back(args, 'followup', failed)).toBe('relaunched')

		const invocation = String(relaunch_mock.mock.calls[0]?.[1])

		expect(invocation).toContain(conflicted)
		expect(invocation).toContain(OUTPUT)
	})

	it('relaunches with no excerpt when no section failed', async () => {
		expect(await run_ship_return.hand_back(args, 'gate', undefined)).toBe('relaunched')
		expect(String(relaunch_mock.mock.calls[0]?.[1])).toContain(`pnpm josh ship --log ${ISSUE}`)
	})
})
