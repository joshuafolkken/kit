import { describe, expect, it, vi } from 'vitest'

const launch_mock = vi.hoisted(() => vi.fn())
const resume_argv_mock = vi.hoisted(() =>
	vi.fn<(invocation: string) => unknown>(() => ({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: undefined,
	})),
)

vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resume_argv: resume_argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch: launch_mock } }))
vi.mock('./lane-dispatch-log', () => ({
	lane_dispatch_log: { default_log_path: () => '/lanes/2428/lane.log' },
}))

const { lane_relaunch } = await import('./lane-relaunch')
const { run_ship_detach } = await import('#scripts/run/run-ship-detach')

const ISSUE = '2428'
const LANE = { issue: ISSUE, directory: '/lanes/2428', profile: undefined }

// joshuafolkken/kit#2428: the detached supervisor relaunches the lane child, and the child inherits the
// supervisor's environment — its supervised mark must not survive, or the child's own in-turn ship
// failure would relaunch a second child beside it.
describe('lane_relaunch.relaunch', () => {
	it('keeps the lane child mark and drops the ship supervisor mark', () => {
		launch_mock.mockReturnValue({ kind: 'launched', pid: 1 })

		lane_relaunch.relaunch(LANE as never, 'fullrun #2428', 'implementation', vi.fn())

		const [request] = (launch_mock.mock.calls[0] ?? []) as ReadonlyArray<{
			env: Record<string, string | undefined>
		}>

		expect(request?.env).toHaveProperty(run_ship_detach.SUPERVISED_KEY, undefined)
		expect(request?.env['JOSH_LANE_CHILD']).toBe(ISSUE)
	})
})

// joshuafolkken/kit#2484: `run:cut` and the `run:merge` cut fallback share one resume relaunch and one
// OpenAI-lane predicate rather than each spelling its own.
describe('lane_relaunch.resume and is_openai_lane', () => {
	it('relaunches with the resume prompt, still ending with the bare fullrun invocation', () => {
		launch_mock.mockReset().mockReturnValue({ kind: 'launched', pid: 1 })

		expect(lane_relaunch.resume(LANE as never, 'pre-gate', vi.fn())).toMatchObject({
			kind: 'launched',
		})
		expect(resume_argv_mock.mock.calls.at(-1)?.[0]).toMatch(/fullrun #2428$/u)
	})

	it('reads an OpenAI profile as an OpenAI lane and any other as not', () => {
		const openai = { ...LANE, profile: { provider: 'openai' } }

		expect(lane_relaunch.is_openai_lane(openai as never)).toBe(true)
		expect(lane_relaunch.is_openai_lane(LANE as never)).toBe(false)
	})
})
