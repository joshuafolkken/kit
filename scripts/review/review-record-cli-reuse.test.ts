import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_record_cli } from './review-record-cli'

// joshuafolkken/kit#4763: a lane resuming on an old record read `Recorded` as "round 1 is done" and
// skipped its own review, so `--check` now answers with the ship's own reuse predicate.

const { reusable_mock } = vi.hoisted(() => ({ reusable_mock: vi.fn() }))

vi.mock('./review-round-reuse', () => ({
	review_round_reuse: {
		REUSE: { AGAIN: 'again', DELTA: 'delta', HELD: 'held' },
		reuse_here: reusable_mock,
	},
}))

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-reuse-'))
const NOW = new Date('2026-10-25T00:00:00Z')
const ISSUE = 4763
const NOT_REUSED = 'Not reused'
const RUN_REVIEW = 'run:review'

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

function recorded_root(): string {
	const file = path.join(TEST_DIR, observation_ledger.ledger_file(ISSUE))

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, `- rf:none | none | - | 2026-10-25 | #${String(ISSUE)}\n`, 'utf8')

	return TEST_DIR
}

async function check_output(): Promise<{ code: number; out: string }> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const code = await review_record_cli.run(
		['--check', '--issue', String(ISSUE)],
		NOW,
		recorded_root(),
	)
	const out = info.mock.calls.map((call) => String(call[0])).join('\n')

	info.mockRestore()

	return { code, out }
}

describe('review_record_cli.run --check — whether josh ship reuses the round', () => {
	beforeEach(() => {
		reusable_mock.mockReset()
	})

	it('tells the lane to run run:review when the ship reviews round 1 again', async () => {
		reusable_mock.mockResolvedValue('again')
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain('Recorded:')
		expect(out).toContain(NOT_REUSED)
		expect(out).toContain('pnpm josh run:review')
	})

	it('answers reused when the ship takes the recorded round as its round 1', async () => {
		reusable_mock.mockResolvedValue('held')
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain('Reused:')
		expect(out).not.toContain(RUN_REVIEW)
	})

	it('asks the shared predicate with the issue', async () => {
		reusable_mock.mockResolvedValue('again')
		await check_output()

		expect(reusable_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('answers not reused, exiting 0, when git could not answer the reuse question', async () => {
		reusable_mock.mockRejectedValue(new Error('git unavailable'))
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain(NOT_REUSED)
	})
})

// joshuafolkken/kit#4878: the ship reuses round 1 and round 2 reads what moved.
describe('review_record_cli.run --check — a round whose delta is left to round 2', () => {
	it('answers reused with the delta left to round 2 when settled files moved', async () => {
		reusable_mock.mockReset().mockResolvedValue('delta')
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain('Reused, delta to round 2:')
		expect(out).not.toContain(NOT_REUSED)
		expect(out).not.toContain(RUN_REVIEW)
	})
})
