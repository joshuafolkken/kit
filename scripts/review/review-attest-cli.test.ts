import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3773: `review:attest --check` refuses an attested review when a person updated the
// run's issue after the review read it — the verdict then describes the earlier specification.

const check_mock = vi.hoisted(() => vi.fn())
const watch_refusal_mock = vi.hoisted(() =>
	vi.fn(async (): Promise<string | undefined> => undefined),
)

vi.mock('./review-attest', () => ({
	review_attest: { check_here: check_mock, refusal_message: () => 'attestation refused' },
}))

vi.mock('#scripts/issue/issue-watch-gate', () => ({
	issue_watch_gate: { review_refusal_here: watch_refusal_mock },
}))

const { review_attest_cli } = await import('./review-attest-cli')

const CHECK_FLAG = '--check'
const OK_EXIT = 0
const FAILURE_EXIT = 1
const WATCH_REFUSAL = 'Issue #3773 was updated after the review was briefed'

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	check_mock.mockResolvedValue({ status: 'ok' })
})

describe('review_attest_cli.run --check — the issue watch', () => {
	it('passes an attested review of the current issue', async () => {
		await expect(review_attest_cli.run([CHECK_FLAG])).resolves.toBe(OK_EXIT)
	})

	it('refuses an attested review the issue moved past', async () => {
		watch_refusal_mock.mockResolvedValueOnce(WATCH_REFUSAL)

		await expect(review_attest_cli.run([CHECK_FLAG])).resolves.toBe(FAILURE_EXIT)
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(WATCH_REFUSAL)
	})

	it('keeps the attestation refusal first, without polling the issue', async () => {
		check_mock.mockResolvedValue({ status: 'missing' })

		await expect(review_attest_cli.run([CHECK_FLAG])).resolves.toBe(FAILURE_EXIT)
		expect(watch_refusal_mock).not.toHaveBeenCalled()
	})

	it('does not poll the issue when no review was briefed', async () => {
		check_mock.mockResolvedValue({ status: 'not-required' })

		await expect(review_attest_cli.run([CHECK_FLAG])).resolves.toBe(OK_EXIT)
		expect(watch_refusal_mock).not.toHaveBeenCalled()
	})
})
