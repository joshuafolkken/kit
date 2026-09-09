import { scoped_green } from '#scripts/scoped-green'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_brief_cli } from './review-brief-cli'

// joshuafolkken/kit#1511: round 1 is refused outright when the scoped checks have never been green on
// this tree, rather than being briefed with a line saying so. A brief that *mentions* the gap is one
// more fact for the review agent to weigh; what has to happen is that no brief exists — this command
// mints the nonce `review:attest --check` compares, so a round that never reaches it cannot be
// counted.
//
// **Only the refusing path is exercised here.** The passing path composes a brief, which mints an
// attestation nonce and writes the round-1 snapshot to the record this checkout's own run relies on —
// the second writer joshuafolkken/kit#1441 and joshuafolkken/kit#1437 both closed. That path is
// unchanged by this issue, and `review-round1-snapshot.test.ts` is where it is pinned.

vi.mock('#scripts/scoped-green', () => ({ scoped_green: { refusal_for: vi.fn() } }))

const mocked_refusal = vi.mocked(scoped_green.refusal_for)

const REFUSAL = '⛔ scoped checks not green on this tree: run them and reissue'
const REFUSED_EXIT_CODE = 1
const NO_ARGUMENTS: ReadonlyArray<string> = []

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh review:brief without a scoped green record', () => {
	it('exits non-zero rather than composing a brief', async () => {
		mocked_refusal.mockReturnValue(REFUSAL)

		await expect(review_brief_cli.run(NO_ARGUMENTS)).resolves.toBe(REFUSED_EXIT_CODE)
	})

	it('puts the refusal on stderr and prints no brief at all', async () => {
		mocked_refusal.mockReturnValue(REFUSAL)

		await review_brief_cli.run(NO_ARGUMENTS)

		expect(console.error).toHaveBeenCalledWith(REFUSAL)
		expect(console.info).not.toHaveBeenCalled()
	})

	it('asks about the resolved change base, not the default-branch name', async () => {
		mocked_refusal.mockReturnValue(REFUSAL)

		await review_brief_cli.run(NO_ARGUMENTS)

		expect(mocked_refusal).toHaveBeenCalledOnce()

		const [, base] = mocked_refusal.mock.calls[0] ?? []

		expect(base === undefined || /^[0-9a-f]{7,40}$/u.test(base)).toBe(true)
	})
})

describe('report_error', () => {
	it('returns the failure code and writes the text it was handed', () => {
		expect(review_brief_cli.report_error(REFUSAL)).toBe(REFUSED_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(REFUSAL)
	})
})
