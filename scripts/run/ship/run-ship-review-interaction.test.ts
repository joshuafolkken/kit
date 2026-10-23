import { gate_tree } from '#scripts/gate/gate-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4276: after round 1, a change to the run tooling owes the interaction review —
// `run_ship_review_steps.review_stage` runs it itself. The round-1 cases are in
// `run-ship-review-steps.test.ts`.

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const record_check_mock = vi.hoisted(() => vi.fn())
const interaction_status_mock = vi.hoisted(() => vi.fn())
const read_stamp_text = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text,
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
			profile: {
				provider: 'anthropic',
				role: 'reviewer',
				model: 'claude-opus-5-5',
				effort: 'high',
			},
		}),
	},
}))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch_attached: launch } }))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: () => [] } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/review/review-record', () => ({ review_record: { check: record_check_mock } }))
vi.mock('#scripts/review/review-interaction', () => ({
	review_interaction: { status: interaction_status_mock },
}))
// A recorded round 1 stands on this tree, so an `ok` record is reused (joshuafolkken/kit#4620).
vi.mock('#scripts/review/review-reviewed-tree', () => ({
	review_reviewed_tree: {
		discard: vi.fn(),
		is_stopped_on: () => false,
		is_unmoved_here: async () => true,
		mark_stopped: vi.fn(),
	},
}))
vi.mock('#scripts/lane/lane-ledger', () => ({ lane_ledger: { record_round_one: vi.fn() } }))

const { run_ship_review_steps } = await import('./run-ship-review-steps')

const OK = 0
const FAILED = 1
const ISSUE = '4276'
const OPEN = 'run:review'
const JOIN = 'run:review --join'
const ATTEST = 'review:attest --check'
const RECORD = `review:record --issue ${ISSUE}`
const INTERACTION_BRIEF = 'review:brief --interaction'
const INTERACTION_RECORD = `${RECORD} --interaction`
const HIGH = 'bug-risks:high:scripts/run/run-board.ts:4'
const MISSING = 'missing'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

async function stage(): Promise<{ code: number }> {
	return await run_ship_review_steps.review_stage(ISSUE)
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: 'brief' })
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: OK })
	record_check_mock.mockReset().mockResolvedValue({ status: MISSING })
	interaction_status_mock.mockReset()
	read_stamp_text.mockReset().mockReturnValue('')
	// Read through git, the tree is this checkout's change, which no case here asserts on (joshuafolkken/kit#4597).
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files: {}, base: undefined })
})

describe('run_ship_review_steps.review_stage — the interaction review', () => {
	it.each(['not-required', 'ok'])('runs none when its status is %s', async (status) => {
		interaction_status_mock.mockResolvedValue(status)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).not.toContain(INTERACTION_BRIEF)
		expect(launch).toHaveBeenCalledOnce()
	})

	it('runs its brief, a reviewer, attest and an interaction record after round 1', async () => {
		interaction_status_mock.mockResolvedValue(MISSING)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([
			OPEN,
			JOIN,
			ATTEST,
			RECORD,
			INTERACTION_BRIEF,
			ATTEST,
			INTERACTION_RECORD,
		])
		expect(launch).toHaveBeenCalledTimes(2)
		expect(interaction_status_mock).toHaveBeenCalledWith(Number(ISSUE))
	})
})

describe('run_ship_review_steps.review_stage — the interaction review beside round 1', () => {
	it('still runs it after a recorded round 1', async () => {
		record_check_mock.mockResolvedValue({ status: 'ok' })
		interaction_status_mock.mockResolvedValue(MISSING)

		expect(await stage()).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual([INTERACTION_BRIEF, ATTEST, INTERACTION_RECORD])
	})

	it('stops on a High it found, after recording it', async () => {
		record_check_mock.mockResolvedValue({ status: 'ok' })
		interaction_status_mock.mockResolvedValue(MISSING)
		read_stamp_text.mockReturnValue(HIGH)

		expect(await stage()).toHaveProperty('code', FAILED)
		expect(commands().at(-1)).toBe(`${INTERACTION_RECORD} ${HIGH}`)
	})

	it('runs none after a round 1 that stopped', async () => {
		interaction_status_mock.mockResolvedValue(MISSING)
		read_stamp_text.mockReturnValue(HIGH)

		expect(await stage()).toHaveProperty('code', FAILED)
		expect(commands()).not.toContain(INTERACTION_BRIEF)
	})
})
