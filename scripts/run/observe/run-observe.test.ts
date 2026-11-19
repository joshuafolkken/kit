import { issue_not_before } from '#scripts/issue/issue-not-before'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_observe, type ObserveDependencies, type ObservePlan } from './run-observe'
import { run_observe_state } from './run-observe-state'

// joshuafolkken/kit#8128: a lane child samples a process hours apart through the body's wait.

const { spawn, unref, read_start, exec_file, issue_get_body } = vi.hoisted(() => ({
	spawn: vi.fn(),
	unref: vi.fn(),
	read_start: vi.fn(),
	exec_file: vi.fn(),
	issue_get_body: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn, execFileSync: exec_file }))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { main_repository_root: async () => '/repo/kit' },
}))
vi.mock('#scripts/josh/process-identity', () => ({ process_identity: { read_start } }))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({ git_gh_issue_read: { issue_get_body } }))

const ISSUE = '8035'
const MINUTE_MS = 60_000
const HALF_HOUR_MS = 30 * MINUTE_MS
const TWO_HOURS_MS = 4 * HALF_HOUR_MS
const T0 = Date.parse('2026-11-19T05:00:00.000Z')
const PID = 4242
const START = 'Thu Nov 19 05:00:00 2026'
const OTHER_START = 'Thu Nov 19 06:00:00 2026'
const BODY = '## 背景\n\n- 種別: 非不具合\n'
const DECLARATION = '実施可能日'
const BOARD: ObservePlan['command'] = ['pnpm', 'josh', 'run:board']
const FINISHED = 'already finished'
const PLAN: ObservePlan = {
	command: BOARD,
	sample: 'ps -o rss= -p "$OBSERVE_PID"',
	offsets_ms: [HALF_HOUR_MS, TWO_HOURS_MS],
}

interface Fake {
	deps: ObserveDependencies
	posted: Array<string>
	stopped: Array<number>
	launches: Array<ReadonlyArray<string>>
	clock: { now: number; start: string | undefined; body: string }
}

function fake(): Fake {
	const posted: Array<string> = []
	const stopped: Array<number> = []
	const launches: Array<ReadonlyArray<string>> = []
	const clock = { now: T0, start: START as string | undefined, body: BODY }
	const deps: ObserveDependencies = {
		launch: async (command) => {
			launches.push(command)

			return { pid: PID + launches.length - 1, process_start: START }
		},
		read_start: () => clock.start,
		run_sample: (_command, pid) => `rss-of-${String(pid)}`,
		stop: (pid) => {
			stopped.push(pid)
		},
		comments: async () => posted,
		post: async (_issue, body) => {
			posted.push(body)

			return `https://example.test/c${String(posted.length)}`
		},
		read_body: async () => clock.body,
		edit_body: async (_issue, body) => {
			clock.body = body
		},
		now: () => clock.now,
	}

	return { deps, posted, stopped, launches, clock }
}

function newest(state: Fake): ReturnType<typeof run_observe_state.latest> {
	return run_observe_state.latest(state.posted)
}

function set_now(state: Fake, now: number): void {
	state.clock.now = now
}

async function started(): Promise<Fake> {
	const state = fake()

	await run_observe.start(ISSUE, PLAN, state.deps)

	return state
}

describe('run_observe.start — records the process and waits for the first sample', () => {
	it('records pid, start time and offsets, and writes the first sample time to the body', async () => {
		const state = fake()
		const printed = await run_observe.start(ISSUE, PLAN, state.deps)

		expect(newest(state)).toMatchObject({ pid: PID, process_start: START, samples: [] })
		expect(issue_not_before.waiting_ms(state.clock.body, T0)).toBe(T0 + HALF_HOUR_MS)
		expect(printed).toContain('the driver relaunches')
	})

	it('refuses when the process cannot be started', async () => {
		const state = fake()

		state.deps.launch = async () => undefined

		await expect(run_observe.start(ISSUE, PLAN, state.deps)).rejects.toThrow('could not start')
	})

	it('refuses a body that already waits on a sample condition, starting nothing', async () => {
		const state = fake()

		state.clock.body = `${BODY}- 実施可能条件: #4426 のマージ後 10 マージ\n`

		await expect(run_observe.start(ISSUE, PLAN, state.deps)).rejects.toThrow('sample condition')
		expect(state.launches).toEqual([])
	})
})

describe('run_observe.sample — the resumed child samples the same process', () => {
	it('takes nothing before the sample time', async () => {
		const state = await started()

		set_now(state, T0 + HALF_HOUR_MS - MINUTE_MS)

		expect(await run_observe.sample(ISSUE, state.deps)).toMatch(
			/not due until .*\nnext: end this session/u,
		)
		expect(newest(state)?.samples).toEqual([])
	})

	it('appends a sample from the same process and waits again for the next time', async () => {
		const state = await started()

		set_now(state, T0 + HALF_HOUR_MS)
		await run_observe.sample(ISSUE, state.deps)

		expect(newest(state)?.samples.map((taken) => taken.value)).toEqual([`rss-of-${String(PID)}`])
		expect(issue_not_before.waiting_ms(state.clock.body, state.clock.now)).toBe(T0 + TWO_HOURS_MS)
		expect(state.stopped).toEqual([])
	})

	it('stops the process after the last sample, drops the wait and names the deliverable', async () => {
		const state = await started()

		set_now(state, T0 + HALF_HOUR_MS)
		await run_observe.sample(ISSUE, state.deps)
		set_now(state, T0 + TWO_HOURS_MS)

		const printed = await run_observe.sample(ISSUE, state.deps)

		expect(newest(state)?.samples).toHaveLength(2)
		expect(state.stopped).toEqual([PID])
		expect(state.clock.body).not.toContain(DECLARATION)
		expect(printed).toContain('--deliverable https://example.test/c3')
		expect(await run_observe.sample(ISSUE, state.deps)).toContain(FINISHED)
	})

	it('refuses an issue with no record', async () => {
		const state = await started()

		state.posted.length = 0

		await expect(run_observe.sample(ISSUE, state.deps)).rejects.toThrow('no run:observe record')
	})
})

async function sampled_gone(state: Fake, now: number, start: string | undefined): Promise<string> {
	set_now(state, now)
	state.clock.start = start

	return await run_observe.sample(ISSUE, state.deps)
}

describe('run_observe.sample — the observed process is gone', () => {
	it('retakes once when the pid names another process', async () => {
		const state = await started()

		expect(await sampled_gone(state, T0 + HALF_HOUR_MS, OTHER_START)).toContain('retaken')
		expect(state.launches).toHaveLength(2)
		expect(newest(state)).toMatchObject({ pid: PID + 1, retakes: 1, samples: [] })
		expect(issue_not_before.waiting_ms(state.clock.body, state.clock.now)).toBeDefined()
	})

	it('records a failure after the retake, and launches nothing more', async () => {
		const state = await started()

		await sampled_gone(state, T0 + HALF_HOUR_MS, OTHER_START)

		expect(await sampled_gone(state, T0 + TWO_HOURS_MS, undefined)).toContain('failed')
		expect(state.launches).toHaveLength(2)
		expect(state.clock.body).not.toContain(DECLARATION)
		expect(await run_observe.sample(ISSUE, state.deps)).toContain(
			`${FINISHED}\nnext: pnpm josh run:step ${ISSUE}`,
		)
	})
})

describe('run_observe.launch — the observed process outlives the lane', () => {
	beforeEach(() => {
		spawn.mockReset().mockReturnValue({ pid: PID, unref })
		read_start.mockReset().mockReturnValue(START)
		vi.stubEnv('JOSH_LANE_CHILD', ISSUE)
		vi.stubEnv('JOSH_CARRY_SESSION', 'parent')
	})

	it('starts the argv as typed in a new session from the main checkout, unmarked', async () => {
		expect(await run_observe.launch(['node', '-e', 'f(x)'])).toEqual({
			pid: PID,
			process_start: START,
		})

		const [command, args, options] = spawn.mock.calls[0] ?? []

		expect([command, args]).toEqual(['node', ['-e', 'f(x)']])
		expect(options).toMatchObject({ cwd: '/repo/kit', detached: true, stdio: 'ignore' })
		expect(options.env).not.toHaveProperty('JOSH_LANE_CHILD')
		expect(options.env).not.toHaveProperty('JOSH_CARRY_SESSION')
		expect(unref).toHaveBeenCalled()
	})

	it('answers nothing when the started process cannot be read', async () => {
		read_start.mockReturnValue(undefined)

		expect(await run_observe.launch(['true'])).toBeUndefined()
	})
})

describe('run_observe — the system side', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('runs the sample with the observed pid in its environment, trimmed', () => {
		exec_file.mockReset().mockReturnValue(' 1234 \n')

		expect(run_observe.run_sample('ps', PID)).toBe('1234')
		expect(exec_file.mock.calls[0]?.[2]?.env).toMatchObject({ OBSERVE_PID: String(PID) })
	})

	it('stops the observed process group, and a gone group is no error', () => {
		const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
			throw new Error('ESRCH')
		})

		run_observe.stop(PID)

		expect(kill).toHaveBeenCalledWith(-PID, 'SIGTERM')
	})

	it('refuses to go on when the body cannot be read, so nothing overwrites it', async () => {
		issue_get_body.mockReset().mockResolvedValue(undefined)

		await expect(run_observe.read_body(ISSUE)).rejects.toThrow('could not read')
	})
})
