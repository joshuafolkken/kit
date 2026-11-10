import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#7020: with `JOSH_REVIEWER_PAIRED=1`, the round 1 `josh ship` opens pairs its code
// brief, starts the paired reviewer beside the code reviewer and records the pair, never gating.

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const offer = vi.hoisted(() => vi.fn())
const pair_launch = vi.hoisted(() => vi.fn())
const pair_argv = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: () => '',
		remove_stamp: vi.fn(),
		stamp_path: (prefix: string) => `stamps/${prefix}x`,
		write_text_stamp: vi.fn(),
	},
}))
vi.mock('#scripts/agent/agent-argv', () => ({
	agent_argv: {
		review_in: () => ({
			kind: 'argv',
			argv: { command: 'claude', args: [] },
			profile: { provider: 'anthropic', role: 'reviewer', model: 'opus', effort: 'high' },
		}),
	},
}))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch_attached: launch } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/review/review-pair', () => ({ review_pair: { offer } }))
vi.mock('#scripts/review/review-pair-session', () => ({
	review_pair_session: { launch: pair_launch, pair_argv },
}))

const { run_ship_reviewer } = await import('./run-ship-reviewer')
const { core_priority } = await import('#scripts/gate/core-priority')
const { PROJECT_ROOT } = await import('#scripts/init/init-paths')

const OK = 0
const ISSUE = '7020'
const CODE_BRIEF = 'the code brief'
const CODE_ONLY_OPEN = ['run:review', '--code-only']
const INTERACTION_OPEN = { open: ['review:brief', '--interaction'], slot: 'interaction' } as const
const PAIR_ARGV = ['review:pair', '--issue', ISSUE, '--opus-agent', 'a', '--sonnet-agent', 'b']

function prompt_of(brief_path: string): string {
	return `read ${brief_path}`
}

async function run_round(
	opens: Parameters<typeof run_ship_reviewer.reviewed_together>[0],
): Promise<unknown> {
	const [open, review] = run_ship_reviewer.reviewed_together(
		opens,
		prompt_of,
		ISSUE,
		run_ship_reviewer.ROUND_ONE,
	)

	await open?.()

	return await review?.()
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: CODE_BRIEF })
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: OK })
	offer.mockReset()
	pair_launch.mockReset().mockResolvedValue(undefined)
	pair_argv.mockReset().mockReturnValue(undefined)
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

describe('run_ship_reviewer — a paired round 1 the ship opens', () => {
	it('pairs the code brief the --code-only open printed and starts its reviewer beside', async () => {
		await run_round([{ open: CODE_ONLY_OPEN, slot: 'code' }])

		expect(offer).toHaveBeenCalledWith(CODE_BRIEF)
		expect(pair_launch).toHaveBeenCalledWith(PROJECT_ROOT, core_priority.PRIORITY_ENVIRONMENT)
	})

	it('records the pair with review:pair once both reviewers ended', async () => {
		pair_argv.mockReturnValue(PAIR_ARGV)

		await run_round([{ open: CODE_ONLY_OPEN, slot: 'code' }])

		expect(josh_run_mock.mock.calls.map(([argv]) => argv)).toStrictEqual([
			CODE_ONLY_OPEN,
			PAIR_ARGV,
		])
	})

	it('keeps the round green when review:pair refuses', async () => {
		pair_argv.mockReturnValue(PAIR_ARGV)
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: CODE_BRIEF })
			.mockResolvedValueOnce({ code: 1, out: '' })

		expect(await run_round([{ open: CODE_ONLY_OPEN, slot: 'code' }])).toHaveProperty('code', OK)
	})
})

describe('run_ship_reviewer — an unpaired round', () => {
	it('records nothing when the round was not paired', async () => {
		await run_round([{ open: CODE_ONLY_OPEN, slot: 'code' }])

		expect(josh_run_mock).toHaveBeenCalledTimes(1)
	})

	it('pairs nothing beside an interaction review alone', async () => {
		await run_round([INTERACTION_OPEN])

		expect(offer).not.toHaveBeenCalled()
		expect(pair_launch).not.toHaveBeenCalled()
	})

	it("never re-records the last round 1's pair on an interaction review alone", async () => {
		pair_argv.mockReturnValue(PAIR_ARGV)

		await run_round([INTERACTION_OPEN])

		expect(josh_run_mock).toHaveBeenCalledTimes(1)
	})
})
