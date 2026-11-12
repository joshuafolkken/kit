import { randomUUID } from 'node:crypto'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import type { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { run_ship_final_review } from '#scripts/run/ship/run-ship-final-review'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { review_attest } from './review-attest'
import { review_final_record } from './review-final-record'
import { review_record_cli } from './review-record-cli'
import { review_record_comment } from './review-record-comment'
import { review_round } from './review-round'
import { review_round_reuse } from './review-round-reuse'
import { review_stamps } from './review-stamps'

vi.mock('./review-record-comment', () => ({
	review_record_comment: {
		post: vi.fn(async () => 0),
		is_after_push: vi.fn(async () => true),
		post_after_push: vi.fn(async () => 0),
	},
}))
vi.mock('./review-fix-round', () => ({
	review_fix_round: { prepare: vi.fn(), lines: () => [], record_reasons: vi.fn() },
}))
vi.mock('#scripts/observations/observation-ledger-home', async (original) => {
	const actual = await original<{ observation_ledger_home: typeof observation_ledger_home }>()

	return { observation_ledger_home: { ...actual.observation_ledger_home, append: vi.fn() } }
})
vi.mock('./review-comment-carry', () => ({
	review_comment_carry: { carry_from_record: vi.fn() },
}))
vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: vi.fn() } }))
vi.mock('./review-round-reuse', () => ({ review_round_reuse: { is_stale_here: vi.fn() } }))

const ISSUE = 6372
const INTERACTION = '--interaction'
const NOW = new Date('2026-11-04T00:00:00Z')
const SOURCE = 'source.ts'
const ROUND_PREFIX = 'josh-review-round-'
const TREE = { base: 'base', files: { [SOURCE]: 'digest' } } satisfies GateTree
const CHECKOUT = { root: PROJECT_ROOT, branch: 'test', head: 'head' }
const review = vi.fn(async () => ({ code: 0, out: 'review' }))
const contract = { nonce: '' }

function stub_contract(): void {
	contract.nonce = randomUUID()
	vi.spyOn(review_attest, 'read_pointer').mockImplementation(() => ({
		nonce: contract.nonce,
		taken_at: NOW.toISOString(),
	}))
	vi.spyOn(review_attest, 'read_expectation').mockReturnValue(CHECKOUT)
	vi.spyOn(review_attest, 'is_attested_on').mockReturnValue(true)
	vi.spyOn(review_attest, 'is_briefed_since').mockReturnValue(true)
}

beforeEach(() => {
	stub_contract()
	vi.spyOn(review_stamps.briefed_stamp, 'read').mockReturnValue({
		...TREE,
		taken_at: NOW.toISOString(),
	})
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(TREE)
	vi.mocked(review_round_reuse.is_stale_here).mockResolvedValue(false)
	vi.mocked(review_record_comment.post).mockResolvedValue(0)
	review.mockClear()
	review_round.record(2)
})

afterEach(() => {
	review_final_record.stamp(String(ISSUE)).remove()
	stamp_file.remove_stamp(stamp_file.stamp_path(ROUND_PREFIX, contract.nonce))
	vi.restoreAllMocks()
})

async function record(finding?: string): Promise<number> {
	return await review_record_cli.run(
		['--issue', String(ISSUE), '--comment', ...(finding === undefined ? [] : [finding])],
		NOW,
	)
}

async function ship(): Promise<void> {
	await run_ship_final_review.run(String(ISSUE), review)
}

it.each([undefined, 'tests:low:source.ts'])(
	'reuses an attested final CLI record: %s',
	async (finding) => {
		expect(await record(finding)).toBe(0)
		await ship()
		expect(review).not.toHaveBeenCalled()
	},
)

it.each(['high', 'medium'])('rejects a blocking final record: %s', async (severity) => {
	await record()
	await record(`tests:${severity}:source.ts`)
	await ship()
	expect(review).toHaveBeenCalledOnce()
})

it('completes a code round recorded through the automatic comment path', async () => {
	expect(await review_record_cli.run(['--issue', String(ISSUE)], NOW)).toBe(0)
	await ship()
	expect(review).not.toHaveBeenCalled()
})

it('keeps a completed code round when an interaction round is recorded', async () => {
	await record()
	expect(await review_record_cli.run(['--issue', String(ISSUE), INTERACTION], NOW)).toBe(0)
	await ship()
	expect(review).not.toHaveBeenCalled()
})

it('rejects an unattested final record', async () => {
	vi.mocked(review_attest.is_attested_on).mockReturnValue(false)
	await record()
	await ship()
	expect(review).toHaveBeenCalledOnce()
})

it('does not complete a normal round one', async () => {
	review_round.record(1)
	await record()
	await ship()
	expect(review).toHaveBeenCalledOnce()
})

it('does not complete a failed comment or an interaction request', async () => {
	vi.mocked(review_record_comment.post).mockResolvedValue(1)
	expect(await record()).toBe(1)
	expect(
		await review_record_cli.run(['--issue', String(ISSUE), '--comment', INTERACTION], NOW),
	).toBe(1)
	await ship()
	expect(review).toHaveBeenCalledOnce()
})

it('does not reuse an older nonce after a new review starts', async () => {
	await record()
	stamp_file.remove_stamp(stamp_file.stamp_path(ROUND_PREFIX, contract.nonce))
	contract.nonce = randomUUID()
	await ship()
	expect(review).toHaveBeenCalledOnce()
})

it('reuses completion under the nonce minted inside the review callback', async () => {
	review.mockImplementationOnce(async () => {
		contract.nonce = randomUUID()

		return { code: 0, out: 'review' }
	})
	await ship()
	await ship()
	expect(review).toHaveBeenCalledOnce()
})

it('keeps the briefed tree rather than approving later edits', async () => {
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue({ ...TREE, files: { [SOURCE]: 'edit' } })
	await record()
	await ship()
	expect(review).toHaveBeenCalledOnce()
})
