import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { review_attest } from './review-attest'
import { review_fix_round, type RecordedRound } from './review-fix-round'
import { review_record_cli } from './review-record-cli'
import { review_stamps } from './review-stamps'

vi.mock('./review-record-code-round', () => ({ review_record_code_round: { follow: vi.fn() } }))
vi.mock('./review-comment-carry', () => ({ review_comment_carry: { carry_from_record: vi.fn() } }))
vi.mock('./review-stop-log', () => ({ review_stop_log: { record: vi.fn() } }))
vi.mock('./review-record-comment', () => ({
	review_record_comment: { is_after_push: vi.fn().mockResolvedValue(false) },
}))

const ROOT = mkdtempSync(path.join(tmpdir(), 'review-record-fix-round-'))
const NOW = new Date('2026-11-04T00:00:00Z')
const ISSUE = 6286
const FILE = 'a.ts'
const REASON = 'Missing boundary check.'
const FINDING = `tests:medium:${FILE}:1 — ${REASON}`

beforeAll(() => {
	vi.spyOn(review_stamps.briefed_stamp, 'read').mockReturnValue({
		taken_at: NOW.toISOString(),
		base: 'base',
		files: { [FILE]: 'old' },
	})
	vi.spyOn(review_attest, 'is_briefed_since').mockReturnValue(true)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterAll(() => {
	vi.restoreAllMocks()
	stamp_file.remove_stamp(stamp_file.stamp_path('josh-review-fix-round-', ROOT))
	rmSync(ROOT, { recursive: true, force: true })
})

function recorded(): RecordedRound {
	const round = review_fix_round.read(ROOT)
	if (round === undefined) throw new Error('round not recorded')

	return round
}

async function record(finding: string): Promise<void> {
	expect(await review_record_cli.run(['--issue', String(ISSUE), finding], NOW, ROOT)).toBe(0)
}

describe('review_record_cli round correspondence (ac-2f995d55)', () => {
	it('persists the body and links resolved findings to the previous recorded round', async () => {
		await record(FINDING)
		const first = recorded()

		await record(`fixed ${FINDING}`)
		const content = readFileSync(path.join(ROOT, observation_ledger.ledger_file(ISSUE)), 'utf8')

		expect(first.findings[0]?.description).toBe(REASON)
		expect(content).toContain(`"previous":"${first.id}"`)
		expect(content).toContain('"status":"resolved"')
		expect(recorded().id).not.toBe(first.id)
	})
})
