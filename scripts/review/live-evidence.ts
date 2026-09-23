import { git_command } from '#scripts/git/git-command'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { reproduction_measure } from '#scripts/issue/reproduction-measure'
import { test_declared_logic, type Verdict } from '#scripts/test/test-declared-logic'

// joshuafolkken/kit#2446. "Done" meant lint, types and unit tests were green and the review found
// nothing — proof the code is right in isolation, never that the feature works where it runs. The
// recent defects (#2402, #2419, #2393) all came through that gap. **This is the seam where it closes**:
// a runtime change merges only once its pull request carries the acceptance criteria run for real —
// the command and the output it actually printed, in the evidence section `EVIDENCE_HEADING` names.
//
// **Two single sources, no new judgement.** Which change needs evidence is `josh test:declared`'s
// runtime-path classification, read against the branch diff rather than the working tree (a followup
// runs after the commit, when `git status` is empty). What counts as evidence is `issue:lint`'s
// reproduction-section parser, so a prose "confirmed it works" is refused here exactly as it is there.

const EVIDENCE_HEADING = '## 実機証跡'

function verdict_for(paths: ReadonlyArray<string>, body: string | undefined): Verdict {
	if (test_declared_logic.runtime_files(paths).length === 0) return 'exempt'

	return reproduction_measure.has_command_output(body ?? '', EVIDENCE_HEADING)
		? 'satisfied'
		: 'required'
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
		'Run the acceptance criteria for real, then add the section: a backticked command followed by a',
		'fenced block holding the output it actually printed (prose such as "confirmed" is not accepted).',
		'Update the body with `gh api -X PATCH repos/{owner}/{repo}/pulls/<N> -F body=@<path>`, then re-run.',
	].join('\n')
}

const live_evidence = { EVIDENCE_HEADING, check, refusal_message, verdict_for }

export { live_evidence }
