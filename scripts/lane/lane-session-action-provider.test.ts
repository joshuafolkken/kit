import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile, type AgentProvider } from '#scripts/agent/agent-role-profile'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_session_action } from './lane-session-action'

const launch_mock = vi.hoisted(() => vi.fn())
const LANE: LaneInfo = {
	issue: '8456',
	directory: '/registered/lane',
	branch: '8456-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: undefined,
}
const ROUNDS = ['1', '2'] as const
const BROKER_SESSION = 'broker-session'
const BROKER_KEYS = [
	agent_role_profile.HANDED_PROVIDER_KEY,
	agent_role_profile.CODEX_SESSION_KEY,
	...agent_session_environment.PARENT_SESSION_KEYS,
]

vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))
vi.mock('#scripts/review/review-pair-session', () => ({
	review_pair_session: { launch: async () => undefined },
}))
vi.mock('./lane-parked', () => ({ lane_parked: { is_parked: async () => false } }))

beforeEach(() => {
	for (const key of BROKER_KEYS) vi.stubEnv(key, undefined)
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

async function expect_provider(provider: AgentProvider, round: '1' | '2'): Promise<void> {
	const profile = { ...agent_role_profile.DEFAULT_PROFILES.worker, provider }
	const answer = await lane_session_action.answer({ ...LANE, profile }, { kind: 'review', round })

	expect(answer).toStrictEqual(lane_session_action.SUCCESS)
	expect(launch_mock).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ profile: expect.objectContaining({ provider }) }),
		expect.any(Function),
	)
}

// joshuafolkken/kit#8456: resolve real reviewer argv against the lane, across broker session keys.
describe('the lane reviewer provider', () => {
	it.each(ROUNDS)(
		'uses Anthropic despite an OpenAI broker in round %s (ac-0cbc157e)',
		async (round) => {
			vi.stubEnv('JOSH_AGENT_PROVIDER', 'openai')

			await expect_provider('anthropic', round)
		},
	)

	it.each(ROUNDS)('ignores a Codex session in round %s (ac-0cbc157e)', async (round) => {
		vi.stubEnv('CODEX_THREAD_ID', BROKER_SESSION)

		await expect_provider('anthropic', round)
	})

	it.each(ROUNDS)(
		'uses OpenAI despite an Anthropic broker in round %s (ac-d3f86174)',
		async (round) => {
			vi.stubEnv('JOSH_AGENT_PROVIDER', 'anthropic')

			for (const key of agent_session_environment.PARENT_SESSION_KEYS) {
				vi.stubEnv(key, BROKER_SESSION)
			}

			await expect_provider('openai', round)
		},
	)
})
