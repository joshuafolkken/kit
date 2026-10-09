import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_pr } from '#scripts/gh/git-pr'
import { error_text } from '#scripts/lib/error-message'
import { live_evidence } from '#scripts/review/live-evidence'
import { changed_paths } from './changed-paths'
import { git_branch } from './git-branch'
import { git_command } from './git-command'
import { git_issue, type IssueInfo } from './git-issue'

// A later stage of `josh git -y` refuses on an unmet precondition — the title's issue number, the
// branch name, the issue's release classification — only after the stage before it has already
// staged, switched or pushed. **Every precondition decidable at the start is asked here, before
// anything changes, and all of them are reported at once.** No rule is new: each
// answer comes from the function the later stage refuses with, so the two cannot drift apart.

interface PreflightInput {
	cli_input: string | undefined
	will_open_pr: boolean
}

// The issue the run resolves to and the branch it will commit on, when both are known.
interface Target {
	number: string
	branch_name: string
}

interface Resolution {
	target: Target | undefined
	problems: Array<string>
}

function resolve_from_branch(current_branch: string): Resolution {
	const number = git_issue.branch_number(current_branch)

	if (number === undefined) {
		return { target: undefined, problems: [git_issue.branch_derivation_error(current_branch)] }
	}

	return { target: { number, branch_name: current_branch }, problems: [] }
}

// A branch is created only from the default branch, so on any other the run commits where it stands.
function resolve_parsed(
	parsed: IssueInfo,
	current_branch: string,
	default_branch: string,
): Resolution {
	const branch_name = current_branch === default_branch ? parsed.branch_name : current_branch
	const target = { number: parsed.number, branch_name }

	if (!git_branch.is_mismatch(current_branch, parsed.branch_name, default_branch)) {
		return { target, problems: [] }
	}

	return {
		target,
		problems: [
			`Branch mismatch: on "${current_branch}", but the title resolves to "${parsed.branch_name}".`,
		],
	}
}

function resolve_from_title(
	cli_input: string,
	current_branch: string,
	default_branch: string,
): Resolution {
	try {
		return resolve_parsed(git_issue.parse(cli_input), current_branch, default_branch)
	} catch (error) {
		return { target: undefined, problems: [error_text.message_of(error)] }
	}
}

async function resolve_target(cli_input: string | undefined): Promise<Resolution> {
	const current_branch = await git_branch.current()

	if (cli_input === undefined) return resolve_from_branch(current_branch)

	return resolve_from_title(cli_input, current_branch, await git_command.get_default_branch())
}

async function classification_problems(target: Target): Promise<Array<string>> {
	try {
		await git_pr.release_classification(target.number, target.branch_name)

		return []
	} catch (error) {
		return [error_text.message_of(error)]
	}
}

// A notice rather than a refusal: the evidence is the output of running the change, which does not
// exist before the commit. Saying so now is what spares the round trip at `josh followup`.
async function announce_evidence(branch_name: string): Promise<void> {
	// Before staging, a new file is still untracked, so the tracked diff alone would miss it.
	const [paths, body] = await Promise.all([
		changed_paths.read_changed_paths(false),
		git_gh_command.pr_get_body(branch_name),
	])

	if (live_evidence.verdict_for(paths, body) !== 'required') return

	console.info(
		`💡 This change touches runtime code: the PR body needs a ${live_evidence.EVIDENCE_HEADING} section before \`josh followup\` merges it.`,
	)
}

function refusal(problems: ReadonlyArray<string>): Error {
	const lines = problems.map((problem) => `  - ${problem}`)

	return new Error(
		[
			`Preflight found ${String(problems.length)} unmet precondition(s); nothing was changed:`,
			...lines,
		].join('\n'),
	)
}

interface PreflightAnswer {
	pr_target: Target | undefined
	problems: Array<string>
}

async function answer(input: PreflightInput): Promise<PreflightAnswer> {
	const { target, problems } = await resolve_target(input.cli_input)
	// The classification and the evidence belong to the pull request, so a `--skip-pr` run asks neither.
	const pr_target = input.will_open_pr ? target : undefined
	const pr_problems = pr_target === undefined ? [] : await classification_problems(pr_target)

	return { pr_target, problems: [...problems, ...pr_problems] }
}

// The unmet preconditions as a list, so `josh ship` can ask them before its
// review and gate start instead of meeting the refusal at the commit stage.
async function problems_of(input: PreflightInput): Promise<Array<string>> {
	const { problems } = await answer(input)

	return problems
}

async function check(input: PreflightInput): Promise<void> {
	const { pr_target, problems } = await answer(input)

	if (problems.length > 0) throw refusal(problems)

	if (pr_target !== undefined) await announce_evidence(pr_target.branch_name)
}

const git_preflight = { check, problems_of }

export type { PreflightInput }
export { git_preflight }
