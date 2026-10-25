import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const gate_tree_mock = vi.hoisted(() => vi.fn())
const record_round_one_mock = vi.hoisted(() => vi.fn())
const stamp_read_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch_attached: launch } }))
vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: gate_tree_mock } }))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: () => [] } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/review/review-record', () => ({
	review_record: { check: async () => ({ status: 'ok' }) },
}))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: async () => undefined } }
})
vi.mock('#scripts/lane/lane-ledger', () => ({
	lane_ledger: { record_round_one: record_round_one_mock, record_round_two: vi.fn() },
}))
vi.mock('#scripts/review/review-stamps', () => ({
	review_stamps: {
		reviewed_stamp: { read: stamp_read_mock, remove: vi.fn(), write: vi.fn() },
		round_one_stamp: { read: () => undefined },
	},
}))
vi.mock('#scripts/review/review-attest', async (import_original) => {
	const { review_attest } = await import_original<Record<'review_attest', object>>()

	return { review_attest: { ...review_attest, is_attested_on: () => true } }
})
vi.mock('#scripts/review/review-checkout', () => ({
	review_checkout: {
		read_checkout: async () => ({ root: '/lanes/4788', branch: '4788-lane', head: 'head' }),
	},
}))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: () => '',
		remove_stamp: vi.fn(),
		stamp_path: (prefix: string) => prefix,
		write_text_stamp: vi.fn(),
	},
}))

const { run_ship_review_steps } = await import('./run-ship-review-steps')

// joshuafolkken/kit#4788: the pre-detach `josh metrics --rerecord` rewrites the branch's approval after
// the lane's `review:record`, and the ship's round 1 still reuses that record.

const ISSUE = '4788'
const BASE = 'base-sha'
const FILE = 'scripts/a.ts'
const APPROVAL = '.josh/metrics-accepted/4788.json'
const STAMP: FileMapStamp = {
	taken_at: '2026-10-25T00:00:00.000Z',
	files: { [FILE]: 'x', [APPROVAL]: 'old' },
	base: BASE,
}

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: 0, out: 'medium\nbrief' })
	launch.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
	record_round_one_mock.mockClear()
	stamp_read_mock.mockReset().mockReturnValue(STAMP)
})

describe('run_ship_review_steps.review_stage — an approval re-recorded after the record', () => {
	it('reuses the recorded round 1 when only the approval changed, running no run:review', async () => {
		gate_tree_mock.mockResolvedValue({ files: { [FILE]: 'x', [APPROVAL]: 'new' }, base: BASE })

		expect(await run_ship_review_steps.review_stage(ISSUE, false)).toMatchObject({
			code: 0,
			is_skipped: true,
		})
		expect(commands()).toStrictEqual([])
		expect(record_round_one_mock).toHaveBeenCalledWith({ issue: Number(ISSUE), verdict: 'reused' })
	})
})
