import { randomUUID } from 'node:crypto'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_round2 } from '#scripts/review/review-round2'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const phases = vi.hoisted(() => ({
	scoped: vi.fn(async () => ({ code: 0, out: '' })),
	provider: vi.fn(async () => ({ code: 0, out: '' })),
	attest: vi.fn(async () => ({ code: 0, out: '' })),
	josh: vi.fn(async (_argv: ReadonlyArray<string>) => ({ code: 0, out: '' })),
	reuse: vi.fn(async () => ({ reuse: 'again', cause: 'unrecorded' })),
	slots: vi.fn(() => ['code']),
}))

vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: async () => ({ base: 'base', files: { source: 'digest' } }) },
}))
vi.mock('#scripts/git/git-command', () => ({ git_command: { head_commit: async () => 'head' } }))
vi.mock('#scripts/review/review-attest', () => ({
	review_attest: {
		REVIEW_SLOT: { CODE: 'code', INTERACTION: 'interaction' },
		check_here: async () => ({ status: 'ok' }),
	},
}))
vi.mock('#scripts/review/review-round-reuse', () => ({
	review_round_reuse: {
		REUSE: { AGAIN: 'again' },
		answer: phases.reuse,
		is_stale_here: async () => false,
	},
}))
vi.mock('#scripts/review/review-interaction', () => ({
	review_interaction: { status: async () => undefined, round_one_slots: phases.slots },
}))
vi.mock('#scripts/review/review-reviewed-tree', () => ({
	review_reviewed_tree: { mark_stopped: vi.fn() },
}))
vi.mock('#scripts/review/review-stop-log', () => ({ review_stop_log: { record: vi.fn() } }))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_round_one: vi.fn(), record_round_two: vi.fn() },
}))
vi.mock(import('./run-ship-scoped'), async (import_original) => {
	const { run_ship_scoped } = await import_original()

	return { run_ship_scoped: { ...run_ship_scoped, scoped_pair: phases.scoped } }
})
vi.mock('./run-ship-reviewer', () => ({
	run_ship_reviewer: {
		ROUND_ONE: '1',
		ROUND_TWO: '2',
		SUCCESS_EXIT_CODE: 0,
		attest_phase: phases.attest,
		current_verdict: () => ({ kind: 'clean', specs: [], report: [] }),
		paths: () => ({ brief: '/nonexistent/ship-review-resume-brief' }),
		josh: phases.josh,
		note: vi.fn(),
		reviewed: () => [phases.provider],
		reviewed_together: () => [phases.provider],
		tagged_phase: (_cause: string, phase: unknown) => phase,
	},
}))
vi.mock('./run-ship-final-review', () => ({
	run_ship_final_review: {
		run: async (_issue: string, phase: () => Promise<unknown>) => await phase(),
	},
}))

const { run_ship_review_steps } = await import('./run-ship-review-steps')
const ISSUE = randomUUID()
const ATTEST_FAILED = { code: 1, out: 'attest failed' }
const RECORD = 'review:record'

beforeEach(() => {
	phases.attest.mockReset().mockResolvedValue({ code: 0, out: '' })
	phases.josh.mockReset().mockResolvedValue({ code: 0, out: '' })
	phases.reuse.mockResolvedValue({ reuse: 'again', cause: 'unrecorded' })
	phases.slots.mockReturnValue(['code'])
})

afterEach(() => {
	for (const stage of ['one-code', 'interaction', 'two']) {
		for (const name of ['scoped', 'provider', 'gate', 'attest', 'record']) {
			file_map_stamp
				.create(`josh-ship-review-step-${ISSUE}-${stage}-${name}-`, PROJECT_ROOT)
				.remove()
		}
	}
})

it('resumes the interaction review without rerunning its scoped pair or provider', async () => {
	phases.reuse.mockResolvedValue({ reuse: 'held', cause: 'recorded' })
	phases.slots.mockReturnValue(['interaction'])
	phases.attest.mockResolvedValueOnce(ATTEST_FAILED)
	expect(await run_ship_review_steps.review_stage(ISSUE)).toMatchObject({ code: 1 })
	expect(await run_ship_review_steps.review_stage(ISSUE)).toMatchObject({ code: 0 })
	expect(phases.scoped).toHaveBeenCalledOnce()
	expect(phases.provider).toHaveBeenCalledOnce()
	expect(phases.attest).toHaveBeenCalledTimes(2)
	expect(phases.josh).toHaveBeenCalledWith([RECORD, '--issue', ISSUE, '--interaction'])
})

it('resumes round two without rerunning its scoped pair or provider', async () => {
	phases.josh.mockImplementation(async (argv: ReadonlyArray<string>) => ({
		code: 0,
		out:
			argv[0] === 'review:round2'
				? review_round2.to_json({ verdict: 'required', code: 'live', reason: 'fix delta' })
				: '',
	}))
	phases.attest.mockResolvedValueOnce(ATTEST_FAILED)
	expect(await run_ship_review_steps.round_two_stage(ISSUE)).toMatchObject({ code: 1 })
	expect(await run_ship_review_steps.round_two_stage(ISSUE)).toMatchObject({ code: 0 })
	expect(phases.scoped).toHaveBeenCalledOnce()
	expect(phases.provider).toHaveBeenCalledOnce()
	expect(phases.attest).toHaveBeenCalledTimes(2)
	expect(phases.josh).toHaveBeenCalledWith([RECORD, '--issue', ISSUE, '--comment'])
})

it('resumes the ship review at attestation with the scoped pair, provider and gate kept (ac-1c214ddb)', async () => {
	phases.attest.mockResolvedValueOnce(ATTEST_FAILED)
	expect(await run_ship_review_steps.review_stage(ISSUE)).toMatchObject({ code: 1 })
	expect(await run_ship_review_steps.review_stage(ISSUE)).toMatchObject({ code: 0 })
	expect(phases.scoped).toHaveBeenCalledOnce()
	expect(phases.provider).toHaveBeenCalledOnce()
	expect(phases.attest).toHaveBeenCalledTimes(2)
	expect(phases.josh.mock.calls).toStrictEqual([
		[['run:review', '--join']],
		[[RECORD, '--issue', ISSUE]],
	])
})
