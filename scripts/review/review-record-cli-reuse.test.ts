import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_lane_handover } from './review-lane-handover'
import { review_record_cli } from './review-record-cli'

// joshuafolkken/kit#4763: a lane resuming on an old record read `Recorded` as "round 1 is done" and
// skipped its own review, so `--check` now answers with the ship's own reuse predicate.

const { reusable_mock } = vi.hoisted(() => ({ reusable_mock: vi.fn() }))

vi.mock('./review-round-reuse', () => ({
	review_round_reuse: {
		REUSE: { AGAIN: 'again', DELTA: 'delta', HELD: 'held' },
		answer_here: reusable_mock,
	},
}))

// The real probe reads this checkout's branch; `review-record-cli-push.test.ts` owns the pushed case.
vi.mock('#scripts/run/ship/run-ship-probe', () => ({
	run_ship_probe: { is_pushed_clean: vi.fn().mockResolvedValue(false) },
}))

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-reuse-'))
const NOW = new Date('2026-10-25T00:00:00Z')
const ISSUE = 4763
const NOT_REUSED = 'Not reused'
const REUSED_DELTA = 'Reused, delta to round 2:'
const RUN_REVIEW = 'run:review'
const RUN_REVIEW_STEP = `pnpm josh ${RUN_REVIEW}`

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

beforeEach(() => {
	vi.spyOn(review_lane_handover, 'is_reopen_refused').mockResolvedValue(false)
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
		reusable_mock.mockResolvedValue({ reuse: 'again' })
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain('Recorded:')
		expect(out).toContain(NOT_REUSED)
		expect(out).toContain(RUN_REVIEW_STEP)
	})

	it('answers reused when the ship takes the recorded round as its round 1', async () => {
		reusable_mock.mockResolvedValue({ reuse: 'held' })
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain('Reused:')
		expect(out).not.toContain(RUN_REVIEW)
	})

	it('asks the shared predicate with the issue', async () => {
		reusable_mock.mockResolvedValue({ reuse: 'again' })
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

// joshuafolkken/kit#4941: the line names the condition that hit and its path, not every condition.
describe('review_record_cli.run --check — why the ship reviews round 1 again', () => {
	it('names the condition and the path that met it', async () => {
		const cause = 'a move round 2 would not read: docs/guide.md'

		reusable_mock.mockReset().mockResolvedValue({ reuse: 'again', cause })
		const { out } = await check_output()

		expect(out).toContain(`${NOT_REUSED}: josh ship reviews round 1 again — ${cause}.`)
		expect(out).not.toContain('a file a recorded High cites')
	})
})

// joshuafolkken/kit#5655: a lane child's attested round 1 refuses the reopen, so the line names the
// ship rather than the `run:review` that would be refused.
describe('review_record_cli.run --check — an attested lane round the ship reviews again', () => {
	it('names the ship, not run:review', async () => {
		vi.mocked(review_lane_handover.is_reopen_refused).mockResolvedValue(true)
		reusable_mock.mockReset().mockResolvedValue({ reuse: 'again' })
		const { out } = await check_output()

		expect(out).toContain(NOT_REUSED)
		expect(out).toContain(review_lane_handover.SHIP_REVIEWS_LINE)
		expect(out).not.toContain(RUN_REVIEW_STEP)
	})
})

// joshuafolkken/kit#4878: the ship reuses round 1 and round 2 reads what moved.
describe('review_record_cli.run --check — a round whose delta is left to round 2', () => {
	it('answers reused with the delta left to round 2 when settled files moved', async () => {
		reusable_mock.mockReset().mockResolvedValue({ reuse: 'delta' })
		const { code, out } = await check_output()

		expect(code).toBe(0)
		expect(out).toContain(REUSED_DELTA)
		expect(out).not.toContain(NOT_REUSED)
		expect(out).not.toContain(RUN_REVIEW)
	})
})

// joshuafolkken/kit#5674: a reuse that passed over unexecuted moves names them, as the ship's reason does.
describe('review_record_cli.run --check — a reuse that passed over unexecuted moves', () => {
	const note = 'moved on no path a round executes: docs/guide.md'

	it('adds the note to the held line', async () => {
		reusable_mock.mockReset().mockResolvedValue({ reuse: 'held', note })
		const { out } = await check_output()

		expect(out).toContain('Reused:')
		expect(out).toContain(` — ${note}`)
	})

	it('adds the note to the delta line', async () => {
		reusable_mock.mockReset().mockResolvedValue({ reuse: 'delta', note })
		const { out } = await check_output()

		expect(out).toContain(REUSED_DELTA)
		expect(out).toContain(` — ${note}`)
	})
})

// joshuafolkken/kit#4983: a lane child no longer runs main:merge before the ship, so the line names
// what the ship's own sync does rather than sending the child to merge.
describe('review_record_cli.run --check — a reused round and the default branch', () => {
	it('leaves the default-branch merge to the ship', async () => {
		reusable_mock.mockResolvedValue({ reuse: 'held' })
		const { out } = await check_output()

		expect(out).toContain('the ship then reviews round 1 again itself')
		expect(out).not.toContain('main:merge')
	})
})
