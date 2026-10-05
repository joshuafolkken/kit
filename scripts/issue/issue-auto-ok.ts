import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { run_carry } from '#scripts/run/run-carry'
import { issue_file } from './issue-file'
import { AUTO_OK_LABEL, has_label_name } from './issue-labels'
import { issue_state_cli } from './issue-state-cli'

// Whether `josh issue:file` applies `auto-ok` to the Issue it files (joshuafolkken/kit#3213). Work
// found during an unattended run used to wait in the backlog until a person labelled it, so the
// filing now computes the answer instead of leaving it to the agent's memory: an Issue filed while a
// `backlogrun` carry record is live, or from a branch whose Issue carries `auto-ok`, is opted in by
// default. `--no-auto-ok` is the one exception, declared for an Issue that needs a person's judgement
// (a Tier B toss-up or a Tier C action). A filing to another repository is never opted in: that
// repository's own `backlogrun` would implement and merge it though nobody opted that repository in.

interface AutoOkSignals {
	is_opted_out: boolean
	is_carried: boolean
	// The labels of the Issue the current branch names; `undefined` when the branch names none or the
	// Issue could not be read.
	branch_labels: ReadonlyArray<string> | undefined
}

interface AutoOkDecision {
	is_applied: boolean
	reason: string
}

const OPTED_OUT: AutoOkDecision = { is_applied: false, reason: '--no-auto-ok declared' }
const CROSS_REPOSITORY: AutoOkDecision = {
	is_applied: false,
	reason: 'the Issue is filed to another repository',
}
const CARRIED: AutoOkDecision = { is_applied: true, reason: 'a backlogrun carry record is live' }
const BRANCH_OPTED_IN: AutoOkDecision = {
	is_applied: true,
	reason: 'the Issue this branch works on carries auto-ok',
}
const NOT_OPTED_IN: AutoOkDecision = {
	is_applied: false,
	reason: 'no backlogrun carry record is live and the branch names no auto-ok Issue',
}

// The opt-out wins over every signal, then the carry record, then the branch's Issue.
function decide(signals: AutoOkSignals): AutoOkDecision {
	if (signals.is_opted_out) return OPTED_OUT
	if (signals.is_carried) return CARRIED
	if (has_label_name(signals.branch_labels ?? [], AUTO_OK_LABEL)) return BRANCH_OPTED_IN

	return NOT_OPTED_IN
}

function line_of(decision: AutoOkDecision): string {
	return `auto-ok: ${decision.is_applied ? 'applied' : 'not applied'} — ${decision.reason}`
}

// Read from the common git directory, so a lane sees the record its batch wrote in the main tree.
async function is_carried(): Promise<boolean> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return false

	return run_carry.read_carry(run_carry.carry_path(directory)).kind === 'carried'
}

// An unreadable Issue is read as no labels: the filing goes on without `auto-ok` rather than failing.
// The branch names an Issue of `current`, read there by name: a filing to another repository has
// already pointed `GH_REPO` at its target, which would otherwise answer with the target's Issue.
async function branch_labels(current: string): Promise<ReadonlyArray<string> | undefined> {
	const issue_number = git_branch.issue_from_branch(await git_command.branch())

	if (issue_number === undefined) return undefined
	const read = await issue_state_cli.read_issue(String(issue_number), current)

	return read.kind === 'state' ? read.state.labels : undefined
}

// Each read is skipped once an earlier signal has already decided the answer; a cross-repository
// filing is refused before any signal is read.
async function resolve(
	is_opted_out: boolean,
	target: string,
	current: string,
): Promise<AutoOkDecision> {
	if (is_opted_out) return OPTED_OUT
	if (!issue_file.is_same_repository(target, current)) return CROSS_REPOSITORY
	if (await is_carried()) return CARRIED

	return decide({ is_opted_out, is_carried: false, branch_labels: await branch_labels(current) })
}

const issue_auto_ok = { decide, line_of, resolve }

export type { AutoOkDecision, AutoOkSignals }
export { issue_auto_ok }
