import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { beforeEach, expect, it, vi } from 'vitest'
import { lane_registry } from './lane-registry'
import { openai_lane_supervisor_cli } from './openai-lane-supervisor-cli'

const find_lane = vi.spyOn(lane_registry, 'find_open_lane')
const error = vi.spyOn(console, 'error')
const ISSUE = '6263'

beforeEach(() => {
	find_lane.mockResolvedValue(undefined)
	error.mockImplementation(() => undefined)
})

it.each([[], [ISSUE]])('logs missing arguments for %j', async (...args) => {
	expect(await openai_lane_supervisor_cli.run(args)).toBe(1)
	expect(error).toHaveBeenCalledWith(expect.stringContaining('missing issue or nonce'))
})

it('logs a missing open lane', async () => {
	expect(await openai_lane_supervisor_cli.run([ISSUE, 'nonce'])).toBe(1)
	expect(error).toHaveBeenCalledWith(expect.stringContaining('no open lane'))
})

it('logs a missing OpenAI profile', async () => {
	find_lane.mockResolvedValue({
		issue: ISSUE,
		branch: '6263-lane',
		directory: '/nonexistent/lane',
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
		profile: agent_role_profile.DEFAULT_PROFILES.worker,
	})

	expect(await openai_lane_supervisor_cli.run([ISSUE, 'nonce'])).toBe(1)
	expect(error).toHaveBeenCalledWith(expect.stringContaining('no OpenAI profile'))
})
