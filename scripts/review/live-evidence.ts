import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { reproduction_measure } from '#scripts/issue/reproduction-measure'
import { report_format_reference } from '#scripts/report/report-format-reference'
import { test_declared_logic, type Verdict } from '#scripts/test/test-declared-logic'

// Lint, types and unit tests green and a review that found nothing prove the code is right in
// isolation, never that the feature works where it runs. **This is the seam where that gap closes**:
// a runtime change merges only once its pull request carries the acceptance criteria run for real —
// the command and the output it actually printed, in the evidence section `EVIDENCE_HEADING` names.
//
// **Two single sources, no new judgement.** Which change needs evidence is `josh test:declared`'s
// runtime-path classification, read against the branch diff rather than the working tree (a followup
// runs after the commit, when `git status` is empty). What counts as evidence is `issue:lint`'s
// reproduction-section parser, so a prose "confirmed it works" is refused here exactly as it is there.

const EVIDENCE_HEADING = '## 実機証跡'
// The shape the section needs and where it is written down, so a refusal
// names the format instead of leaving the reader to search for it.
const EVIDENCE_FORMAT = `under ${EVIDENCE_HEADING}, a backticked command followed by a fenced block holding the output it actually printed (prose such as "confirmed" is not accepted) — format: ${report_format_reference.pointer(report_format_reference.COMPLETION_REPORT_HEADING)}`

function verdict_for(paths: ReadonlyArray<string>, body: string | undefined = ''): Verdict {
	if (test_declared_logic.runtime_files(paths).length === 0) return 'exempt'

	return reproduction_measure.has_command_output(body, EVIDENCE_HEADING) ? 'satisfied' : 'required'
}

// The diff is this checkout's, so it answers for the named branch only when that is the one checked
// out: a `followup --branch <lane>` run from `main` would read an empty diff as `exempt` and merge a
// runtime change with no evidence. Refused rather than guessed.
async function assert_checked_out(branch_name: string): Promise<void> {
	const current = await git_command.branch()

	if (current === branch_name) return

	throw new Error(
		`The ${EVIDENCE_HEADING} check reads this checkout's diff, which is ${current}, not ${branch_name}; run followup from ${branch_name}'s checkout.`,
	)
}

async function check(branch_name: string): Promise<Verdict> {
	await assert_checked_out(branch_name)

	const [names, body] = await Promise.all([
		git_command.diff_main_names(),
		git_gh_command.pr_get_body(branch_name),
	])

	return verdict_for(names.split('\n'), body)
}

function refusal_message(): string {
	return [
		`Merge refused: this pull request changes runtime code but its body has no ${EVIDENCE_HEADING} section.`,
		'Run the acceptance criteria for real, then add the section:',
		EVIDENCE_FORMAT,
		'Update the body with `gh api -X PATCH repos/{owner}/{repo}/pulls/<N> -F body=@<path>`, then re-run.',
	].join('\n')
}

const live_evidence = { EVIDENCE_FORMAT, EVIDENCE_HEADING, check, refusal_message, verdict_for }

export { live_evidence }
