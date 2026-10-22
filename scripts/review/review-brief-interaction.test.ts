import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { bash_output_cap_reader } from '#scripts/document/bash-output-cap'
import { scoped_green } from '#scripts/gate/scoped-green'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { issue_watch_gate } from '#scripts/issue/issue-watch-gate'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removed_tests_check } from './removed-tests-check'
import { review_attest } from './review-attest'
import { review_brief } from './review-brief'
import { review_brief_cli } from './review-brief-cli'
import { review_checkout } from './review-checkout'
import { review_code_tree } from './review-code-tree'
import { review_diff_write } from './review-diff-write'
import { review_interaction } from './review-interaction'
import { review_stamps } from './review-stamps'
import { review_tree } from './review-tree'

// joshuafolkken/kit#4276. `review:brief --interaction` briefs the adversarial pass over a change to the
// run tooling, and records none of `/code-review`'s round stamps — that round already ran.

const DUE_FILE = 'scripts/run/run-board.ts'
const OTHER_FILE = 'scripts/gate/scoped-green.ts'
const COMMIT = 'fedcba9876543210fedcba9876543210fedcba98'
const OUTPUT_CAP = 30_000
const INTERACTION_FLAG = '--interaction'
const STALE_REFUSAL = 'issue-updated-after-round-one-sentinel'

function stub_change(paths: ReadonlyArray<string>): void {
	vi.spyOn(change_base, 'resolved').mockResolvedValue(COMMIT)
	vi.spyOn(changed_paths, 'read_changed_paths').mockResolvedValue([...paths])
	vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue(
		Object.fromEntries(paths.map((file) => [file, 'digest'])),
	)
}

function stub_review(): void {
	vi.spyOn(scoped_green, 'refusal_for').mockReturnValue(undefined)
	vi.spyOn(issue_watch_gate, 'review_refusal_here').mockResolvedValue(undefined)
	vi.spyOn(agent_role_profile, 'warn_of_default').mockReturnValue()
	vi.spyOn(review_checkout, 'read_checkout').mockResolvedValue({
		root: '/lanes/4276',
		branch: '4276-lane',
		head: '0123456789abcdef0123456789abcdef01234567',
	})
	vi.spyOn(review_attest, 'record_target').mockReturnValue('deadbeefcafef00d')
	vi.spyOn(lane_session_broker, 'review_paths').mockReturnValue({
		brief: '/scratch/brief.md',
		findings: '/scratch/findings.txt',
		log: '/scratch/review.log',
	})
	vi.spyOn(bash_output_cap_reader, 'bash_output_cap').mockReturnValue(OUTPUT_CAP)
	vi.spyOn(review_diff_write, 'write_parts').mockRejectedValue(new Error('no parts'))
	vi.spyOn(removed_tests_check, 'read').mockResolvedValue(undefined)
}

function stub_stamps(): void {
	for (const stamp of [
		review_stamps.gate_stamp,
		review_stamps.in_flight_stamp,
		review_stamps.round_one_stamp,
		review_stamps.briefed_stamp,
	]) {
		vi.spyOn(stamp, 'read').mockReturnValue(undefined)
	}

	vi.spyOn(review_stamps.round_one_stamp, 'write').mockReturnValue('')
	vi.spyOn(review_stamps.briefed_stamp, 'write').mockReturnValue('')
	vi.spyOn(review_code_tree, 'record').mockResolvedValue()
}

// A clean, attested round 1 briefed on a tree `DUE_FILE` has changed from since — the reading a
// relaunched ship takes after the child edited the tree, and the one a round-1 brief narrows on.
function stub_clean_round_one(): void {
	vi.spyOn(review_stamps.briefed_stamp, 'read').mockReturnValue({
		taken_at: '2026-10-22T00:00:00.000Z',
		files: { [DUE_FILE]: 'before', [OTHER_FILE]: 'digest' },
		base: COMMIT,
	})
	vi.spyOn(review_attest, 'is_briefed_since').mockReturnValue(true)
	vi.spyOn(review_attest, 'is_reviewed_on').mockReturnValue(true)
	vi.spyOn(run_ship_review, 'is_clean_round_one').mockReturnValue(true)
}

function printed(): string {
	return vi
		.mocked(console.info)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	stub_review()
	stub_stamps()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('review:brief --interaction', () => {
	it('says the pass is not due and exits 0 when no run-tooling path changed', async () => {
		stub_change([OTHER_FILE])

		await expect(review_brief_cli.run([INTERACTION_FLAG])).resolves.toBe(0)
		expect(printed()).toBe(review_interaction.NOT_DUE_LINE)
	})

	it('briefs the interaction role over the run-tooling paths', async () => {
		stub_change([DUE_FILE, OTHER_FILE])

		await expect(review_brief_cli.run([INTERACTION_FLAG])).resolves.toBe(0)
		expect(printed()).toContain('## Interaction review')
		expect(printed()).toContain(`- ${DUE_FILE}`)
		expect(printed()).not.toContain(`- ${OTHER_FILE}`)
	})

	it('records no round-one or briefed stamp', async () => {
		stub_change([DUE_FILE])
		await review_brief_cli.run([INTERACTION_FLAG])

		expect(review_stamps.round_one_stamp.write).not.toHaveBeenCalled()
		expect(review_stamps.briefed_stamp.write).not.toHaveBeenCalled()
	})

	it('reads the whole change where a resumed round 1 would narrow to the delta', async () => {
		stub_change([DUE_FILE, OTHER_FILE])
		stub_clean_round_one()

		await review_brief_cli.run([])
		expect(printed()).toContain(review_brief.RESUMED_HEADING)

		vi.mocked(console.info).mockClear()
		await review_brief_cli.run([INTERACTION_FLAG])

		expect(printed()).not.toContain(review_brief.RESUMED_HEADING)
		expect(printed()).toContain('Target: the whole change')
	})

	it('reads an extra argument as a usage error', async () => {
		stub_change([DUE_FILE])

		await expect(review_brief_cli.run([INTERACTION_FLAG, 'extra'])).resolves.toBe(1)
	})
})

// Minting the brief moves the pointer `josh followup` measures an issue update against, so a round 1
// that read the earlier specification would merge without the refusal.
describe('review:brief --interaction after an issue update', () => {
	it('refuses, minting no brief, when the update was taken in after round 1 was briefed', async () => {
		stub_change([DUE_FILE])
		vi.spyOn(issue_watch_gate, 'review_refusal_here').mockResolvedValue(STALE_REFUSAL)

		await expect(review_brief_cli.run([INTERACTION_FLAG])).resolves.toBe(1)
		expect(console.error).toHaveBeenCalledWith(STALE_REFUSAL)
		expect(review_attest.record_target).not.toHaveBeenCalled()
	})
})
