import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { review_comment_carry } from './review-comment-carry'
import { review_comment_round } from './review-comment-round'

vi.mock('./review-comment-round', async (original) => {
	const actual = await original<{ review_comment_round: typeof review_comment_round }>()

	return { review_comment_round: { ...actual.review_comment_round, carry: vi.fn() } }
})

const ROOT = '/nonexistent/review-comment-carry'
const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-comment-carry-'))
const CARRIED = '.josh/observations/5267-comment-rounds.md'
const LEDGER = '.josh/observations/5267.md'

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

async function printed_by_carry(): Promise<{ info: string; warn: string }> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

	await review_comment_carry.carry_reported(ROOT)
	const printed = {
		info: info.mock.calls.flat().join('\n'),
		warn: warn.mock.calls.flat().join('\n'),
	}

	info.mockRestore()
	warn.mockRestore()

	return printed
}

function written(relative: string): string {
	const file_path = path.join(TEST_DIR, relative)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, '- line\n')

	return file_path
}

// joshuafolkken/kit#5326: `review:record` and `observations:flush` both run the carry through here.
describe('review_comment_carry.carry_reported', () => {
	it('carries into the root it is given and says how many lines', async () => {
		vi.mocked(review_comment_round.carry).mockResolvedValueOnce(3)

		const printed = await printed_by_carry()

		expect(review_comment_round.carry).toHaveBeenCalledWith(ROOT)
		expect(printed.info).toBe(`Carried 3 ${review_comment_carry.CARRIED_LINE}`)
	})

	it('prints nothing when there was nothing to carry', async () => {
		vi.mocked(review_comment_round.carry).mockResolvedValueOnce(0)

		expect(await printed_by_carry()).toEqual({ info: '', warn: '' })
	})

	it('warns rather than throwing when the carry fails', async () => {
		vi.mocked(review_comment_round.carry).mockRejectedValueOnce(new Error('gh refused'))

		const printed = await printed_by_carry()

		expect(printed.warn).toBe(`${review_comment_carry.CARRY_FAILED_LINE} gh refused`)
	})
})

// joshuafolkken/kit#5326: a carried file a stopped flush left untracked would block the next
// flush's fast-forward.
describe('review_comment_carry.discard_uncommitted', () => {
	it('removes an untracked carried file', () => {
		const carried = written(CARRIED)

		review_comment_carry.discard_uncommitted(`?? ${CARRIED}\n`, TEST_DIR)

		expect(existsSync(carried)).toBe(false)
	})

	it('keeps a tracked carried file and any other ledger file', () => {
		const carried = written(CARRIED)
		const ledger = written(LEDGER)

		review_comment_carry.discard_uncommitted(` M ${CARRIED}\n?? ${LEDGER}\n`, TEST_DIR)

		expect(existsSync(carried)).toBe(true)
		expect(existsSync(ledger)).toBe(true)
	})
})
