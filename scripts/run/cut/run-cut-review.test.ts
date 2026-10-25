import { git_command } from '#scripts/git/git-command'
import { review_attest } from '#scripts/review/review-attest'
import { review_prior_findings } from '#scripts/review/review-prior-findings'
import { review_record } from '#scripts/review/review-record'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_cut, type RunCut } from './run-cut'
import type { Handoff } from './run-cut-handoff'
import { run_cut_review } from './run-cut-review'

// joshuafolkken/kit#4868: a cut between an attested round 1 and its `review:record` dropped the
// findings with the conversation, and the resumed lane reran round 1. These pin the refusal that keeps
// the round, and the resume that prints a recorded round back.

const ISSUE = '4868'
const BRANCH = '4868-lane'
const ROOT = '/lanes/4868'
const FINDING =
	'scripts/a.ts:12 — the guard reads the wrong root (code, fixed in place in the round-1 stage)'
const HANDOFF: Handoff = { instruction: 'go', completed: [], remaining: [], untouched: [] }
const IMPLEMENTATION = { issue: ISSUE, branch: BRANCH, phase: run_cut.IMPLEMENTATION_PHASE }

const is_attested_on = vi.spyOn(review_attest, 'is_attested_on')
const record_check = vi.spyOn(review_record, 'check')
const latest = vi.spyOn(review_prior_findings, 'latest')
const errors = vi.spyOn(console, 'error').mockReturnValue()

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(git_command, 'repository_root').mockResolvedValue(ROOT)
	is_attested_on.mockReturnValue(true)
	record_check.mockResolvedValue({ status: 'missing', issue: Number(ISSUE) })
	latest.mockReturnValue([FINDING])
})

afterAll(() => {
	vi.restoreAllMocks()
})

describe('an implementation cut over an attested, unrecorded round', () => {
	it('is refused with the record command for the issue', async () => {
		const note = await run_cut_review.unrecorded_refusal(IMPLEMENTATION, HANDOFF)

		expect(note).toContain(`review:record --issue ${ISSUE}`)
		expect(note).toContain('"findings"')
		expect(is_attested_on).toHaveBeenCalledWith({ branch: BRANCH }, ROOT)
	})

	it('is taken when the handoff carries the findings', async () => {
		const note = await run_cut_review.unrecorded_refusal(IMPLEMENTATION, {
			...HANDOFF,
			findings: [FINDING],
		})

		expect(note).toBeUndefined()
	})

	it('is taken when the round is recorded', async () => {
		record_check.mockResolvedValue({ status: 'ok', issue: Number(ISSUE) })

		expect(await run_cut_review.unrecorded_refusal(IMPLEMENTATION, HANDOFF)).toBeUndefined()
	})

	it('is taken when no round is attested on this branch', async () => {
		is_attested_on.mockReturnValue(false)

		expect(await run_cut_review.unrecorded_refusal(IMPLEMENTATION, HANDOFF)).toBeUndefined()
		expect(record_check).not.toHaveBeenCalled()
	})

	it('never asks for a pre-gate cut', async () => {
		const scope = { ...IMPLEMENTATION, phase: run_cut.PRE_GATE_PHASE }

		expect(await run_cut_review.unrecorded_refusal(scope, undefined)).toBeUndefined()
		expect(is_attested_on).not.toHaveBeenCalled()
	})
})

// The stated handoff format parses, so a copied example must not pass for a carried round.
describe('an implementation cut whose handoff copied the format placeholder', () => {
	it('is refused as if it carried no findings', async () => {
		const note = await run_cut_review.unrecorded_refusal(IMPLEMENTATION, {
			...HANDOFF,
			findings: ['unrecorded'],
		})

		expect(note).toContain(`review:record --issue ${ISSUE}`)
	})
})

function cut_record(handoff: Handoff | undefined): RunCut {
	return {
		invocation: `fullrun #${ISSUE}`,
		issue: ISSUE,
		branch: BRANCH,
		phase: run_cut.IMPLEMENTATION_PHASE,
		cut_at: '2026-10-25T00:00:00.000Z',
		handoff,
	}
}

function printed(): string {
	return errors.mock.calls.flat().join('\n')
}

describe('the implementation resume', () => {
	it('prints a recorded round 1 and its findings, and not to rerun it', async () => {
		record_check.mockResolvedValue({ status: 'ok', issue: Number(ISSUE) })

		await run_cut_review.announce_resume(cut_record(HANDOFF), true)

		expect(printed()).toContain(run_cut_review.RECORDED_ROUND_HEADING)
		expect(printed()).toContain(FINDING)
		expect(latest).toHaveBeenCalledWith(ISSUE, expect.any(Function))
	})

	it('prints no round when none is recorded', async () => {
		await run_cut_review.announce_resume(cut_record(HANDOFF), true)

		expect(printed()).not.toContain(run_cut_review.RECORDED_ROUND_HEADING)
		expect(printed()).toContain('go')
	})

	it('reads no record for a pre-gate resume', async () => {
		await run_cut_review.announce_resume(cut_record(undefined), false)

		expect(record_check).not.toHaveBeenCalled()
		expect(errors).not.toHaveBeenCalled()
	})
})
