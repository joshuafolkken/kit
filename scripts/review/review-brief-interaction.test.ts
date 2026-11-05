import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { bash_output_cap_reader } from '#scripts/document/bash-output-cap'
import { scoped_green } from '#scripts/gate/scoped-green'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { issue_watch_gate } from '#scripts/issue/issue-watch-gate'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removed_tests_check } from './removed-tests-check'
import { review_attest } from './review-attest'
import { review_brief } from './review-brief'
import { review_brief_cli } from './review-brief-cli'
import { review_brief_paths } from './review-brief-paths'
import { review_checkout } from './review-checkout'
import { review_code_tree } from './review-code-tree'
import { review_diff_write } from './review-diff-write'
import { review_fix_round, type RecordedRound } from './review-fix-round'
import { review_interaction } from './review-interaction'
import { review_reviewed_tree } from './review-reviewed-tree'
import { review_round } from './review-round'
import { review_round_one_skip } from './review-round-one-skip'
import { review_size } from './review-size'
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
const INTERACTION_HEADING = '## Interaction review'
const WHOLE_CHANGE = 'Target: the whole change'
const RECORDED: RecordedRound = {
	id: 'previous-round',
	issue: 6286,
	snapshot: JSON.stringify({ taken_at: '', files: {}, base: COMMIT }),
	findings: [
		{
			category: 'bug-risks',
			severity: 'medium',
			file: OTHER_FILE,
			description: 'Check the boundary.',
		},
	],
}

function stub_change(paths: ReadonlyArray<string>): void {
	vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(COMMIT)
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

// Keep environment values out of assertion failure output.
function profile_arguments(): ReadonlyArray<readonly [number, boolean, boolean | undefined]> {
	return vi
		.mocked(agent_role_profile.resolve_review)
		.mock.calls.map(([round, environment, reduced]) => [
			round,
			Object.is(environment, process.env),
			reduced,
		])
}

beforeEach(() => {
	vi.spyOn(review_size, 'read').mockResolvedValue(undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	stub_review()
	stub_stamps()
	vi.spyOn(review_round_one_skip, 'eligible_issue').mockResolvedValue(undefined)
	vi.spyOn(lane_ledger_write, 'record_round_one').mockResolvedValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('review:brief automatic final round', () => {
	it('automatically briefs the whole change with the final profile when round one can be skipped', async () => {
		stub_change([OTHER_FILE])
		vi.mocked(review_round_one_skip.eligible_issue).mockResolvedValue(6243)
		vi.spyOn(agent_role_profile, 'resolve_review')

		await expect(review_brief_cli.run([])).resolves.toBe(0)
		expect(printed()).toContain(review_round.FINAL_LINE)
		expect(printed()).toContain(WHOLE_CHANGE)
		expect(profile_arguments()).toEqual([[review_brief.SECOND_ROUND, true, false]])
		expect(lane_ledger_write.record_round_one).toHaveBeenCalledWith({
			issue: 6243,
			verdict: 'skipped',
		})
		expect(review_stamps.round_one_stamp.write).not.toHaveBeenCalled()
	})

	it('keeps an explicit round one and records no skip when the scoped gate refuses', async () => {
		stub_change([OTHER_FILE])
		vi.mocked(review_round_one_skip.eligible_issue).mockResolvedValue(6243)
		vi.spyOn(agent_role_profile, 'resolve_review')

		await expect(review_brief_cli.run(['--round', '1'])).resolves.toBe(0)
		expect(profile_arguments()).toEqual([[1, true, false]])
		expect(review_round_one_skip.eligible_issue).not.toHaveBeenCalled()
		vi.mocked(scoped_green.refusal_for).mockReturnValue('not checked')
		await expect(review_brief_cli.run([])).resolves.toBe(1)
		expect(lane_ledger_write.record_round_one).not.toHaveBeenCalled()
	})
})

describe('review:brief tiny executable diff', () => {
	it('prints low and the reduced profile for 20 lines (ac-267e5f8b)', async () => {
		stub_change([OTHER_FILE])
		vi.mocked(review_size.read).mockResolvedValue(20)
		const resolve = vi.spyOn(agent_role_profile, 'resolve_review')

		await review_brief_cli.run(['--round', '1'])

		expect(resolve.mock.calls[0]?.[2]).toBe(true)
		expect(printed()).toContain('low')
		expect(printed()).toContain('sonnet')
	})
})

describe('review:brief --full-change', () => {
	it('mints a full-change final brief and records its own tree without replacing round one', async () => {
		stub_change([OTHER_FILE])
		vi.spyOn(agent_role_profile, 'resolve_review')
		const record = vi.spyOn(review_round, 'record')

		await expect(review_brief_cli.run(['--full-change'])).resolves.toBe(0)
		expect(printed()).toContain(review_round.FINAL_LINE)
		expect(printed()).toContain(WHOLE_CHANGE)
		expect(profile_arguments()).toEqual([[review_brief.SECOND_ROUND, true, false]])
		expect(record).toHaveBeenCalledWith(review_brief.SECOND_ROUND)
		expect(review_stamps.round_one_stamp.write).not.toHaveBeenCalled()
		expect(review_stamps.briefed_stamp.write).toHaveBeenCalledWith(
			{ [OTHER_FILE]: 'digest' },
			undefined,
			COMMIT,
			expect.any(Object),
		)
	})
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
		expect(printed()).toContain(INTERACTION_HEADING)
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
		expect(printed()).toContain(WHOLE_CHANGE)
	})

	it('reads an extra argument as a usage error', async () => {
		stub_change([DUE_FILE])

		await expect(review_brief_cli.run([INTERACTION_FLAG, 'extra'])).resolves.toBe(1)
	})
})

// joshuafolkken/kit#4941: the round-2 brief names the files a recorded High cites, from its record.
describe('review:brief --round 2 — the High-cited files', () => {
	it('names the files the reviewed-tree record cites', async () => {
		stub_change([DUE_FILE])
		vi.spyOn(review_reviewed_tree, 'high_cited').mockReturnValue([DUE_FILE])

		await expect(review_brief_cli.run(['--round', '2'])).resolves.toBe(0)
		expect(printed()).toContain(`${review_brief_paths.HIGH_FIX_LINE}\n  /lanes/4276/${DUE_FILE}`)
	})
})

// `josh run:review` hands `run_to` a writer, since its two briefs together exceed the Bash output cap
// (joshuafolkken/kit#4863): every brief and the not-due line go to it, none to the console.
describe('review:brief recorded findings', () => {
	it('keeps the recorded findings before replacing the review contract', async () => {
		stub_change([OTHER_FILE])
		const resume = vi.spyOn(review_fix_round, 'resume').mockReturnValue(RECORDED)

		vi.mocked(review_attest.record_target).mockImplementation(() => {
			resume.mockReturnValue(undefined)

			return 'replacement-nonce'
		})
		const compose = vi.spyOn(review_brief, 'compose')

		await expect(review_brief_cli.run_to([], vi.fn())).resolves.toBe(0)
		expect(compose).toHaveBeenCalledWith(expect.objectContaining({ fix_round: RECORDED }))
		expect(resume).toHaveBeenCalledBefore(vi.mocked(review_attest.record_target))
	})
})

describe('review:brief run_to', () => {
	it('sends the code brief to emit, printing nothing', async () => {
		stub_change([DUE_FILE, OTHER_FILE])
		const emit = vi.fn<(text: string) => void>()

		await expect(review_brief_cli.run_to([], emit)).resolves.toBe(0)
		expect(emit).toHaveBeenCalledTimes(1)
		expect(String(emit.mock.calls[0]?.[0])).toContain(WHOLE_CHANGE)
		expect(console.info).not.toHaveBeenCalled()
	})

	it('sends the interaction brief to emit, printing nothing', async () => {
		stub_change([DUE_FILE, OTHER_FILE])
		const emit = vi.fn<(text: string) => void>()

		await expect(review_brief_cli.run_to([INTERACTION_FLAG], emit)).resolves.toBe(0)
		expect(String(emit.mock.calls[0]?.[0])).toContain(INTERACTION_HEADING)
		expect(console.info).not.toHaveBeenCalled()
	})

	it('sends the not-due line to emit, printing nothing', async () => {
		stub_change([OTHER_FILE])
		const emit = vi.fn<(text: string) => void>()

		await expect(review_brief_cli.run_to([INTERACTION_FLAG], emit)).resolves.toBe(0)
		expect(emit).toHaveBeenCalledWith(review_interaction.NOT_DUE_LINE)
		expect(console.info).not.toHaveBeenCalled()
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
