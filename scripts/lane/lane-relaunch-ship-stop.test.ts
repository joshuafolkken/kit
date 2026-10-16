import { describe, expect, it, vi } from 'vitest'

const spawn_mock = vi.hoisted(() => vi.fn(() => ({ pid: 4242, on: vi.fn(), unref: vi.fn() })))

vi.mock('node:child_process', async (original) => ({
	...(await original<Record<string, unknown>>()),
	spawn: spawn_mock,
}))
vi.mock('#scripts/run/launch-priority', () => ({ launch_priority: { lower: vi.fn() } }))
vi.mock('./lane-dispatch-log', () => ({ lane_dispatch_log: { default_log_path: () => undefined } }))

const { agent_role_profile } = await import('#scripts/agent/agent-role-profile')
const { lane_child_invocation } = await import('./lane-child-invocation')
const { lane_relaunch } = await import('./lane-relaunch')

const ISSUE = '3964'
const LANE = {
	issue: ISSUE,
	directory: '/lanes/3964',
	profile: agent_role_profile.DEFAULT_PROFILES.worker,
}
const STOP = { stage: 'gate', flags: [], is_review: true, title: `Some work #${ISSUE}` } as const
const EXCERPT_LINES = 40
const LINE_PADDING = 200

function long_excerpt(): Array<string> {
	return Array.from(
		{ length: EXCERPT_LINES },
		(_, index) => `FAIL line ${String(index)} ${'x'.repeat(LINE_PADDING)}`,
	)
}

// joshuafolkken/kit#3964: the ship-stop prompt joins its lines with line breaks and carries the failed
// output's tail, and the launcher's argv check refused it — every lane whose ship stopped went 🛑.
describe('the ship-stop relaunch through the argv check', () => {
	it('launches a child whose prompt carries a long excerpt and the changed files', () => {
		const context = { excerpt: long_excerpt(), changed: ['scripts/a.ts'], more_changed: 0 }
		const prompt = lane_child_invocation.ship_stop_invocation(ISSUE, { ...STOP, context })

		const result = lane_relaunch.relaunch(LANE as never, prompt, 'pre-gate', vi.fn())

		expect(result).toStrictEqual({ kind: 'launched', pid: 4242 })
		expect(prompt.length).toBeLessThanOrEqual(agent_role_profile.MAX_VALUE_LENGTH)
		expect(prompt).toContain('FAIL line 39')
		expect(prompt.endsWith(`fullrun #${ISSUE}`)).toBe(true)
	})
})
