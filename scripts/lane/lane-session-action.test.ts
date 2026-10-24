import { api_auth } from '#scripts/agent/api-auth'
import { deferred_answer } from '#scripts/git/deferred-answer-fixture'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_ship_stop_cause } from '#scripts/run/ship/run-ship-stop-cause'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'
import { lane_session_action, type BrokerAnswer } from './lane-session-action'

const argv_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const parked_mock = vi.hoisted(() => vi.fn())
const exists_mock = vi.hoisted(() => vi.fn())
const ROUND_ONE = { kind: 'review', round: '1' } as const
const BOTH_SLOTS = ['code', 'interaction'] as const
const FIX_IN_PLACE = 'Apply a fix'
const SUBMIT = 'pnpm josh review:submit'
const AUTH_FAILED_LOG = JSON.stringify({
	type: 'result',
	is_error: true,
	result: 'Failed to authenticate: OAuth session expired and could not be refreshed',
})
const RELAUNCH = {
	kind: 'relaunch',
	stop: { stage: 'review', title: 'Address the review', flags: [], is_review: true, conflicts: [] },
} as const
const LANE: LaneInfo = {
	issue: '3974',
	directory: '/registered/lane',
	branch: '3974-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: undefined,
}

vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { review_in: argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))
vi.mock('./lane-parked', () => ({ lane_parked: { is_parked: parked_mock } }))
vi.mock(import('node:fs'), async (import_original) => ({
	...(await import_original()),
	existsSync: exists_mock,
}))

beforeEach(() => {
	argv_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: { provider: 'anthropic', role: 'reviewer', model: 'opus', effort: 'high' },
	})
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
	parked_mock.mockReset().mockResolvedValue(false)
	exists_mock.mockReset().mockReturnValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function reason_of(answer: BrokerAnswer): string {
	return answer.is_success ? '' : answer.reason
}

// joshuafolkken/kit#3926: the verification pass resolves its own profile, and the log names it.
describe('lane_session_action.answer — a review round', () => {
	it('resolves the reviewer for the round it starts and logs that round with its model', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(vi.fn())

		await lane_session_action.answer(LANE, { kind: 'review', round: '2' })

		expect(argv_mock.mock.calls[0]?.[1]).toBe(2)
		expect(error).toHaveBeenCalledWith(
			'review round 2 · provider=anthropic role=reviewer model=opus effort=high',
		)
	})
})

// joshuafolkken/kit#4216: a reviewer whose session expired is named so, not left a bare exit code.
describe('lane_session_action.answer — a reviewer that could not authenticate', () => {
	it('names an authentication failure the reviewer log ends on', async () => {
		launch_mock.mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 1 })
		vi.spyOn(stamp_file, 'read_stamp_text').mockReturnValue(AUTH_FAILED_LOG)

		const answer = await lane_session_action.answer(LANE, ROUND_ONE)

		expect(reason_of(answer)).toBe(`${api_auth.AUTH_FAILURE_NOTE}: the reviewer exited with code 1`)
	})
})

describe('lane_session_action.answer', () => {
	it('answers success when the reviewer exits cleanly', async () => {
		const answer = await lane_session_action.answer(LANE, ROUND_ONE)

		expect(answer).toStrictEqual(lane_session_action.SUCCESS)
	})

	it('names the reviewer exit code when it fails', async () => {
		launch_mock.mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 2 })

		const answer = await lane_session_action.answer(LANE, ROUND_ONE)

		expect(reason_of(answer)).toBe('the reviewer exited with code 2')
	})

	it('refuses a parked issue', async () => {
		parked_mock.mockResolvedValue(true)

		const answer = await lane_session_action.answer(LANE, RELAUNCH)

		expect(reason_of(answer)).toBe('the issue is parked')
	})

	it('names the note of a rejected relaunch', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockReturnValue({ kind: 'rejected', note: 'no profile' })

		const answer = await lane_session_action.answer(LANE, RELAUNCH)

		expect(reason_of(answer)).toBe('the relaunch did not start: no profile')
	})

	it('answers a thrown action as a failure naming its error', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockImplementation(() => {
			throw new Error('spawn EACCES')
		})

		const answer = await lane_session_action.answer(LANE, RELAUNCH)

		expect(reason_of(answer)).toBe('the broker failed: spawn EACCES')
	})
})

// joshuafolkken/kit#4672: `/code-review` and the interaction review run side by side.
describe('lane_session_action — review slots', () => {
	it('gives each slot its own brief, findings and log', () => {
		const code = lane_session_action.review_paths(LANE.directory, 'code')
		const interaction = lane_session_action.review_paths(LANE.directory, 'interaction')

		expect(interaction.brief).not.toBe(code.brief)
		expect(interaction.findings).not.toBe(code.findings)
		expect(interaction.log).not.toBe(code.log)
	})

	it('launches one reviewer per slot and answers the first failure', async () => {
		launch_mock
			.mockResolvedValueOnce({ kind: 'completed', pid: 1, exit_code: 0 })
			.mockResolvedValueOnce({ kind: 'completed', pid: 2, exit_code: 3 })

		const answer = await lane_session_action.answer(LANE, {
			...ROUND_ONE,
			slots: ['code', 'interaction'],
		})

		expect(launch_mock).toHaveBeenCalledTimes(2)
		expect(reason_of(answer)).toBe('the reviewer exited with code 3')
	})
})

describe('lane_session_action — slot reviewers side by side', () => {
	it('starts every slot reviewer before any of them finishes', async () => {
		const held = deferred_answer<{ kind: 'completed'; pid: number; exit_code: number }>()

		launch_mock.mockReturnValue(held.promise)
		const answer = lane_session_action.answer(LANE, { ...ROUND_ONE, slots: BOTH_SLOTS })

		await vi.waitFor(() => {
			expect(launch_mock).toHaveBeenCalledTimes(2)
		})
		held.answer({ kind: 'completed', pid: 1, exit_code: 0 })

		await expect(answer).resolves.toStrictEqual(lane_session_action.SUCCESS)
	})

	it('leaves the interaction reviewer beside the code reviewer read only', async () => {
		await lane_session_action.answer(LANE, { ...ROUND_ONE, slots: BOTH_SLOTS })

		const [code, interaction] = argv_mock.mock.calls.map(([prompt]) => String(prompt))

		expect(code).toContain(FIX_IN_PLACE)
		expect(interaction).toContain('Do not edit any file')
		expect(interaction).not.toContain(FIX_IN_PLACE)
	})

	// joshuafolkken/kit#4799: a reviewer that copied the findings path dropped `ship-` from it.
	it('hands each slot reviewer its submit command, never its findings path', async () => {
		await lane_session_action.answer(LANE, { ...ROUND_ONE, slots: BOTH_SLOTS })

		const [code, interaction] = argv_mock.mock.calls.map(([prompt]) => String(prompt))

		expect(code).toContain(`\`${SUBMIT}\``)
		expect(interaction).toContain(`\`${SUBMIT} --interaction\``)

		for (const slot of BOTH_SLOTS) {
			const { findings } = lane_session_action.review_paths(LANE.directory, slot)

			expect(`${String(code)}${String(interaction)}`).not.toContain(findings)
		}
	})
})

describe('lane_session_action — a lane on either side of review:submit', () => {
	// A consumer's josh is the kit package's, so its script is found under `node_modules`.
	it('finds the submit command in a consumer lane', async () => {
		exists_mock.mockImplementation((target: string) => target.includes('node_modules'))

		await lane_session_action.answer(LANE, ROUND_ONE)

		expect(String(argv_mock.mock.calls[0]?.[0])).toContain(`\`${SUBMIT}\``)
	})

	// The supervisor reloads onto main, so it serves lanes branched before `review:submit` existed.
	it('hands a lane without the submit command its findings path', async () => {
		exists_mock.mockReturnValue(false)

		await lane_session_action.answer(LANE, ROUND_ONE)

		const prompt = String(argv_mock.mock.calls[0]?.[0])

		expect(prompt).toContain(lane_session_action.review_paths(LANE.directory, 'code').findings)
		expect(prompt).not.toContain(SUBMIT)
	})
})

// joshuafolkken/kit#4221: a stale review rides on the stop, so the strict schema must take it.
describe('lane_session_action.action_schema — a relaunch stop', () => {
	it('takes a stale review', () => {
		const stop = { ...RELAUNCH.stop, is_review_stale: true }
		const parsed = lane_session_action.action_schema.safeParse({ ...RELAUNCH, stop })

		expect(parsed.success).toBe(true)
	})
})

// joshuafolkken/kit#4489: the ship tags its stop with a cause, and the strict schema refused every relaunch.
describe('lane_session_action.action_schema — a stop cause', () => {
	it.each(Object.values(run_ship_stop_cause.CAUSE))('takes the %s cause', (cause) => {
		const stop = { ...RELAUNCH.stop, cause }

		expect(lane_session_action.action_schema.safeParse({ ...RELAUNCH, stop }).success).toBe(true)
	})

	it('refuses a cause the ship never writes', () => {
		const stop = { ...RELAUNCH.stop, cause: 'weather' }

		expect(lane_session_action.action_schema.safeParse({ ...RELAUNCH, stop }).success).toBe(false)
	})
})
