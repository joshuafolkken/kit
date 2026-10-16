import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const resolve_in_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: vi.fn(() => ''),
		remove_stamp: vi.fn(),
		stamp_path: vi.fn((prefix: string) => `stamps/${prefix}x`),
		write_text_stamp: vi.fn(),
	},
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: resolve_in_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch_attached: launch } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: vi.fn(async () => ({ files: {}, base: 'base' })) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { missing_scripts: vi.fn(() => []) },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/review/review-record', () => ({
	review_record: { check: vi.fn(async () => ({ status: 'missing' })) },
}))

const { run_ship_review_steps } = await import('./run-ship-review-steps')
const { lane_session_broker } = await import('#scripts/lane/lane-session-broker')
const broker_request = vi.spyOn(lane_session_broker, 'request')
const broker_serving = vi.spyOn(lane_session_broker, 'is_serving')

// A lane child's round-1 reviewer, started by the lane's broker rather than by the ship itself.

const OK = 0
const FAILED = 1
const ISSUE = '2427'
const OPEN = 'run:review'
const ARGV = { command: 'claude', args: ['-p', 'prompt'] }
const ROUND_ONE = { kind: 'review', round: '1' }
const UNSERVED = 'no broker serves this lane'
const ANTHROPIC_REVIEWER_PROFILE = {
	provider: 'anthropic',
	role: 'reviewer',
	model: 'claude-opus-5-5',
	effort: 'high',
}
const OPENAI_REVIEWER_PROFILE = {
	provider: 'openai',
	role: 'reviewer',
	model: 'gpt-6.1-sol',
	effort: 'high',
}

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

function reviewer_on(profile: typeof ANTHROPIC_REVIEWER_PROFILE): void {
	resolve_in_mock.mockReturnValue({ kind: 'argv', argv: ARGV, profile })
}

async function stage_code(): Promise<number> {
	const result = await run_ship_review_steps.review_stage(ISSUE)

	return result.code
}

beforeEach(() => {
	josh_run_mock.mockReset().mockImplementation(async (argv: ReadonlyArray<string>) => ({
		code: OK,
		out: argv.join(' ') === OPEN ? 'medium\nbrief body' : '',
	}))
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: OK })
	reviewer_on(ANTHROPIC_REVIEWER_PROFILE)
	is_child_mock.mockReset().mockReturnValue(true)
	broker_request.mockReset().mockResolvedValue({ is_success: false, reason: UNSERVED })
	broker_serving.mockReset().mockReturnValue(false)
})

describe('run_ship_review_steps.review_stage — isolated OpenAI lane', () => {
	it('uses the registered reviewer broker instead of a nested Codex launch', async () => {
		reviewer_on(OPENAI_REVIEWER_PROFILE)
		broker_request.mockResolvedValue({ is_success: true })

		expect(await stage_code()).toBe(OK)
		expect(broker_request).toHaveBeenCalledWith(expect.any(String), ISSUE, ROUND_ONE)
		expect(launch).not.toHaveBeenCalled()
	})

	it('stops before attestation when the isolated reviewer is unavailable', async () => {
		reviewer_on(OPENAI_REVIEWER_PROFILE)

		expect(await stage_code()).toBe(FAILED)
		expect(commands()).toStrictEqual([OPEN])
		expect(launch).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#3974: the broker's reason reaches the ship log instead of a bare failure.
	it("names the broker's reason when the isolated reviewer fails", async () => {
		reviewer_on(OPENAI_REVIEWER_PROFILE)
		const result = await run_ship_review_steps.review_stage(ISSUE)

		expect(result.out).toContain(`isolated reviewer failed: ${UNSERVED}`)
	})
})

// joshuafolkken/kit#3817: a Claude lane child's ship never received the token, so the reviewer is asked
// of the supervisor's broker whenever one serves the lane.
describe('run_ship_review_steps.review_stage — Claude lane child', () => {
	it('asks the serving broker for the reviewer instead of launching it', async () => {
		broker_serving.mockReturnValue(true)
		broker_request.mockResolvedValue({ is_success: true })

		expect(await stage_code()).toBe(OK)
		expect(broker_request).toHaveBeenCalledWith(expect.any(String), ISSUE, ROUND_ONE)
		expect(launch).not.toHaveBeenCalled()
	})

	it('launches the reviewer itself when no broker serves the lane', async () => {
		expect(await stage_code()).toBe(OK)
		expect(broker_request).not.toHaveBeenCalled()
		expect(launch).toHaveBeenCalledOnce()
	})
})
