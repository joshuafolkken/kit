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
	review_round_reuse: { is_reusable_here: reusable_mock },
}))

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-reuse-'))
const NOW = new Date('2026-10-25T00:00:00Z')
const ISSUE = 4763
const NOT_REUSED = 'Not reused'

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

	it('tells the lane to run run:review when the tree moved since the record', async () => {
		reusable_mock.mockResolvedValue(false)
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain('Recorded:')
		expect(out).toContain(NOT_REUSED)
		expect(out).toContain('pnpm josh run:review')
	})

	it('answers reused when the ship takes the recorded round as its round 1', async () => {
		reusable_mock.mockResolvedValue(true)
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain('Reused:')
		expect(out).not.toContain('run:review')
	})

	it('asks the shared predicate with the issue', async () => {
		reusable_mock.mockResolvedValue(false)
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
