import { PassThrough } from 'node:stream'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { codex_agent_argv } from '#scripts/agent/codex-agent-argv'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detached_launch } from './detached-launch'

const spawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn }))

const ISSUE = '2071'
const LANE = `/work/.kit-lanes/${ISSUE}`
const WORKER = agent_role_profile.OPENAI_PROFILES.worker

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

function fake_child(): PassThrough {
	const child = Object.assign(new PassThrough(), {
		pid: undefined,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		unref: vi.fn(),
	})

	queueMicrotask(() => child.emit('close', 0))

	return child
}

describe('Codex lane identity at the shared spawn boundary', () => {
	it.each(['attached', 'detached'])(
		'passes the explicit mark to %s shell configuration',
		async (mode) => {
			spawn.mockImplementation(fake_child)
			const request = {
				argv: codex_agent_argv.build(`fullrun #${ISSUE}`, WORKER, LANE),
				cwd: LANE,
				profile: WORKER,
				env: lane_child_marker.env_for(ISSUE),
			}
			if (mode === 'attached') await detached_launch.launch_attached(request, vi.fn())
			else detached_launch.launch(request, vi.fn())

			expect(spawn.mock.lastCall?.[1]).toContain(
				`shell_environment_policy.set.JOSH_LANE_CHILD="${ISSUE}"`,
			)
			expect(spawn.mock.lastCall?.[1]?.at(-1)).toBe(`fullrun #${ISSUE}`)
		},
	)
})
