import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const review_in_mock = vi.hoisted(() => vi.fn())
const record_check_mock = vi.hoisted(() => vi.fn())
const record_round_one_mock = vi.hoisted(() => vi.fn())
const discard_mock = vi.hoisted(() => vi.fn())
const unmoved_mock = vi.hoisted(() => vi.fn())
const stopped_on_mock = vi.hoisted(() => vi.fn())
const mark_stopped_mock = vi.hoisted(() => vi.fn())
const stamps = vi.hoisted(() => ({
	read_stamp_text: vi.fn(),
	remove_stamp: vi.fn(),
	stamp_path: vi.fn((prefix: string) => `stamps/${prefix}x`),
	write_text_stamp: vi.fn(),
}))

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({ stamp_file: stamps }))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { review_in: review_in_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch_attached: launch } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: vi.fn(async () => ({ files: {}, base: 'base' })) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: () => [] } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/review/review-record', () => ({ review_record: { check: record_check_mock } }))
vi.mock('#scripts/review/review-interaction', () => ({
	review_interaction: { status: async () => undefined },
}))
vi.mock('#scripts/lane/lane-ledger', () => ({
	lane_ledger: { record_round_one: record_round_one_mock, record_round_two: vi.fn() },
}))
vi.mock('#scripts/review/review-reviewed-tree', () => ({
	review_reviewed_tree: {
		discard: discard_mock,
		is_stopped_on: stopped_on_mock,
		is_unmoved_here: unmoved_mock,
		mark_stopped: mark_stopped_mock,
	},
}))

const { run_ship_review_steps } = await import('./run-ship-review-steps')

// joshuafolkken/kit#4620: a round 1 recorded before the ship is reused while the tree holds still, and
// each round 1 the ship acts on leaves its verdict in the lane ledger.

const OK = 0
const FAILED = 1
const SKIPPED = { code: OK, is_skipped: true }
const ISSUE = '4620'
const OPEN = 'run:review'
const REVIEWED = [
	OPEN,
	'run:review --join',
	'review:attest --check',
	`review:record --issue ${ISSUE}`,
]
const HIGH = 'bug-risks:high:a.ts:4'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

function recorded_verdict(verdict: string): unknown {
	return { issue: Number(ISSUE), verdict }
}

beforeEach(() => {
	josh_run_mock.mockReset().mockImplementation(async (argv: ReadonlyArray<string>) => ({
		code: OK,
		out: argv.join(' ') === OPEN ? 'medium\nbrief' : '',
	}))
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: OK })
	review_in_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: { provider: 'anthropic', role: 'reviewer', model: 'claude-opus-5-5', effort: 'high' },
	})
	record_check_mock.mockReset().mockResolvedValue({ status: 'ok' })
	record_round_one_mock.mockClear()
	discard_mock.mockClear()
	unmoved_mock.mockReset().mockResolvedValue(true)
	stopped_on_mock.mockReset().mockReturnValue(false)
	mark_stopped_mock.mockClear()
	stamps.read_stamp_text.mockReset().mockReturnValue('')
})

describe('run_ship_review_steps.review_stage — a recorded round 1', () => {
	// joshuafolkken/kit#3643: a round that ran no review says so, so the ship does not time it as one.
	it('reuses a recorded round on an unmoved tree, running no review', async () => {
		expect(await run_ship_review_steps.review_stage(ISSUE, false)).toMatchObject(SKIPPED)
		expect(commands()).toStrictEqual([])
		expect(launch).not.toHaveBeenCalled()
		expect(record_round_one_mock).toHaveBeenCalledWith(recorded_verdict('reused'))
	})

	it('reviews again once the tree moved since the record, recording the clean verdict', async () => {
		unmoved_mock.mockResolvedValue(false)

		expect(await run_ship_review_steps.review_stage(ISSUE, false)).toHaveProperty('code', OK)
		expect(commands()).toStrictEqual(REVIEWED)
		expect(record_round_one_mock).toHaveBeenCalledWith(recorded_verdict('clean'))
	})

	// joshuafolkken/kit#4221: an `ok` record is no reuse once the review is stale — it read the issue
	// before its update — so that case runs stale.
	it.each(['missing', 'not-required', 'ok'])('runs the review on a %s record', async (status) => {
		record_check_mock.mockResolvedValue({ status })

		expect(await run_ship_review_steps.review_stage(ISSUE, status === 'ok')).toHaveProperty(
			'code',
			OK,
		)
		expect(commands()).toContain(OPEN)
	})

	it('discards the record on a stale issue without asking whether the tree moved', async () => {
		await run_ship_review_steps.review_stage(ISSUE, true)

		expect(discard_mock).toHaveBeenCalledOnce()
		expect(unmoved_mock).not.toHaveBeenCalled()
	})

	it('records a blocking verdict and stops on it', async () => {
		unmoved_mock.mockResolvedValue(false)
		stamps.read_stamp_text.mockReturnValue(`${HIGH}\n`)

		expect(await run_ship_review_steps.review_stage(ISSUE, false)).toHaveProperty('code', FAILED)
		expect(record_round_one_mock).toHaveBeenCalledWith(recorded_verdict('blocking'))
		expect(mark_stopped_mock).toHaveBeenCalledWith(Number(ISSUE), true)
	})
})

describe('run_ship_review_steps.review_stage — after the ship stopped on a finding', () => {
	it('clears the stop marker when round 1 passes', async () => {
		unmoved_mock.mockResolvedValue(false)

		await run_ship_review_steps.review_stage(ISSUE, false)

		expect(mark_stopped_mock).toHaveBeenCalledWith(Number(ISSUE), false)
	})

	// joshuafolkken/kit#2964: the lane's fix moved the tree, and that fix delta is round 2's alone.
	it('reuses a round the ship stopped on, on a tree the fix moved', async () => {
		unmoved_mock.mockResolvedValue(false)
		stopped_on_mock.mockReturnValue(true)

		expect(await run_ship_review_steps.review_stage(ISSUE, false)).toMatchObject(SKIPPED)
		expect(commands()).toStrictEqual([])
		expect(stopped_on_mock).toHaveBeenCalledWith(Number(ISSUE))
	})

	it('reviews again on a stale issue even after a stop', async () => {
		stopped_on_mock.mockReturnValue(true)

		await run_ship_review_steps.review_stage(ISSUE, true)

		expect(commands()).toContain(OPEN)
	})
})
