import { describe, expect, it, vi } from 'vitest'

const OK = 'ok'
const NOT_REQUIRED = vi.hoisted(() => 'not-required')
const ALLOWS_MERGE_TITLE = 'allows the merge when the verdict is %s'
const NO_MERGE_TITLE = 'leaves a --no-merge run alone'

const attest_check_mock = vi.hoisted(() => vi.fn(async () => ({ status: NOT_REQUIRED })))
const REFUSAL_SENTINEL = vi.hoisted(() => 'attestation-refusal-sentinel')

vi.mock('#scripts/review/review-attest', () => ({
	review_attest: {
		check_here: attest_check_mock,
		refusal_message: () => REFUSAL_SENTINEL,
	},
}))

// The issue watch polls GitHub, so it is mocked (joshuafolkken/kit#3773).
const WATCH_REFUSAL = vi.hoisted(() => 'issue-watch-refusal-sentinel')
const watch_refusal_mock = vi.hoisted(() =>
	vi.fn(async (): Promise<string | undefined> => undefined),
)

vi.mock('#scripts/issue/issue-watch-gate', () => ({
	issue_watch_gate: { review_refusal_here: watch_refusal_mock },
}))

// The real checks read the observation ledger and the branch diff of whatever run executes the suite.
const RECORD_REFUSAL_SENTINEL = vi.hoisted(() => 'record-refusal-sentinel')
const record_check_mock = vi.hoisted(() => vi.fn(async () => ({ status: NOT_REQUIRED })))

vi.mock('#scripts/review/review-record', () => ({
	review_record: {
		check: record_check_mock,
		refusal_message: () => RECORD_REFUSAL_SENTINEL,
	},
}))

const INTERACTION_REFUSAL = vi.hoisted(() => 'interaction-refusal-sentinel')
const interaction_mock = vi.hoisted(() => vi.fn(async (): Promise<string | undefined> => undefined))

vi.mock('#scripts/review/review-interaction', () => ({
	review_interaction: { refusal: interaction_mock },
}))

const { followup_review_gates } = await import('./followup-review-gates')

// The `/code-review` subagent inherits the session's directory, so a lane run can be reviewed against
// the previous child's already-merged code, where there is nothing wrong to find. The review returns
// no findings and the run reads that as clean. This is the seam where that stops being free.
describe('a merge is refused unless the review attested its checkout', () => {
	// The whole point: the defect produced *no* signal, so silence must not read as success.
	it.each([['missing'], ['mismatch']])('throws when the verdict is %s', async (status) => {
		attest_check_mock.mockResolvedValueOnce({ status })

		await expect(followup_review_gates.assert_review_attested(true)).rejects.toThrow(
			REFUSAL_SENTINEL,
		)
	})

	it.each([[OK], [NOT_REQUIRED]])(ALLOWS_MERGE_TITLE, async (status) => {
		attest_check_mock.mockResolvedValueOnce({ status })

		await expect(followup_review_gates.assert_review_attested(true)).resolves.toBeUndefined()
	})

	// joshuafolkken/kit#3773: an attested review of the earlier specification is still refused.
	it('throws on an issue update the review did not read', async () => {
		attest_check_mock.mockResolvedValueOnce({ status: OK })
		watch_refusal_mock.mockResolvedValueOnce(WATCH_REFUSAL)

		await expect(followup_review_gates.assert_review_attested(true)).rejects.toThrow(WATCH_REFUSAL)
	})

	// A `--no-merge` run has not reached the gate this record guards, and nothing merges there. The
	// clearing half moved with the run's tail — `git-followup-finish.test.ts` covers it.
	it(NO_MERGE_TITLE, async () => {
		attest_check_mock.mockClear()
		await followup_review_gates.assert_review_attested(false)

		expect(attest_check_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2343. Recording a review round was prose, and across eleven merges the call was
// never made. This is the seam where an unrecorded round stops being free: the merge is refused
// unless the round left a line for its issue.
describe('a merge is refused unless the review round was recorded', () => {
	const RECORDED_ISSUE = '2343'

	it('throws when the round is missing', async () => {
		record_check_mock.mockResolvedValueOnce({ status: 'missing' })

		await expect(
			followup_review_gates.assert_review_recorded(true, RECORDED_ISSUE),
		).rejects.toThrow(RECORD_REFUSAL_SENTINEL)
	})

	it.each([[OK], [NOT_REQUIRED]])(ALLOWS_MERGE_TITLE, async (status) => {
		record_check_mock.mockResolvedValueOnce({ status })

		await expect(
			followup_review_gates.assert_review_recorded(true, RECORDED_ISSUE),
		).resolves.toBeUndefined()
	})

	it(NO_MERGE_TITLE, async () => {
		record_check_mock.mockClear()
		await followup_review_gates.assert_review_recorded(false, RECORDED_ISSUE)

		expect(record_check_mock).not.toHaveBeenCalled()
	})

	it('carries on when no issue number can identify the round', async () => {
		record_check_mock.mockClear()
		await followup_review_gates.assert_review_recorded(true, undefined)

		expect(record_check_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4276. A change to the run tooling also owes the interaction review's round.
describe('a merge is refused unless a due interaction review was recorded', () => {
	const ISSUE = '4276'

	it('throws the interaction refusal for the issue', async () => {
		record_check_mock.mockResolvedValueOnce({ status: OK })
		interaction_mock.mockResolvedValueOnce(INTERACTION_REFUSAL)

		await expect(followup_review_gates.assert_review_recorded(true, ISSUE)).rejects.toThrow(
			INTERACTION_REFUSAL,
		)
		expect(interaction_mock).toHaveBeenCalledWith(Number(ISSUE))
	})

	it('allows the merge when the interaction gate has no refusal', async () => {
		record_check_mock.mockResolvedValueOnce({ status: OK })

		await expect(followup_review_gates.assert_review_recorded(true, ISSUE)).resolves.toBeUndefined()
	})
})
