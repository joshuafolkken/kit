import { propagate_git } from './propagate-git'
import type { StepResult } from './propagate-run'

// Where `josh git` actually stopped inside a consumer, and what it left there.
//
// `josh git` is three things under one command — stage and commit, push, open the pull request — and
// a failed spawn reports one exit code for all three. The run's report then appended "upgrade/sync
// changes left uncommitted" to that code, which names the *first* of the three: so a consumer whose
// pre-push hook refused the push was reported as a consumer whose sync never got committed, and the
// reader went looking at a sync that had worked (joshuafolkken/kit#1417).
//
// **Nothing here changes whether a push is blocked.** A consumer's pre-push gate refusing a push is
// the gate doing its job, and the probes below are read-only. What is fixed is the sentence.

// The last lines of `josh git`'s own output are what name the check that stopped it: a pre-push hook
// prints its steps as it runs them and ends on the one that failed, and git's refusal follows. Three
// lines carry that pair without breaking the report's one-line-per-consumer shape.
const TAIL_LINE_COUNT = 3
const TAIL_SEPARATOR = ' / '
// eslint-disable-next-line no-control-regex -- the escape sequences to strip are control characters
const ANSI_PATTERN = /\[[0-9;?]*[ -/]*[@-~]/gu
const LINE_BREAK_PATTERN = /[\r\n]/u
const TAIL_LABEL = 'last output: '
const NO_COMMIT = 'nothing was committed'
const NOT_OPENED = 'the branch reached origin, but the pull request was not opened'
const HOOK_REFUSED = "but the consumer's pre-push hook refused the push"
const PUSH_FAILED = 'but the push did not reach origin'
const NOTHING_LEFT = 'nothing was left behind'
const LEFTOVER_LABEL = 'left behind: '
const LEFTOVER_JOIN = ' and '
const UNCOMMITTED = 'uncommitted changes'

// The facts one classification is made from, gathered once so the decision itself stays pure and
// testable without a repository.
interface GitStepState {
	// The feature branch `josh git` created, or nothing when the checkout is still on its default
	// branch — which is what a failure before the branch existed looks like. Written as "present,
	// possibly undefined" rather than optional: `exactOptionalPropertyTypes` is on and the probes
	// below answer `undefined` rather than omitting the key, which is the same reason
	// `git-fixture-workspace.ts` declares `restore_environment` this way.
	branch: string | undefined
	// The commit that branch carries beyond the default branch, or nothing when it carries none.
	head_commit: string | undefined
	is_tree_clean: boolean
	is_on_remote: boolean
	is_push_hook_blocked: boolean
}

// The remote half of the state, kept apart because it is the half that costs network round trips.
interface PushState {
	is_on_remote: boolean
	is_push_hook_blocked: boolean
}

const NOT_PUSHED: PushState = { is_on_remote: false, is_push_hook_blocked: false }

function push_reason(state: GitStepState): string {
	return state.is_push_hook_blocked ? HOOK_REFUSED : PUSH_FAILED
}

// Which of `josh git`'s three sub-steps stopped, read from what the consumer's repository holds now.
function describe_failure(state: GitStepState): string {
	const { branch, head_commit } = state
	if (branch === undefined || head_commit === undefined) return NO_COMMIT
	if (state.is_on_remote) return NOT_OPENED

	return `committed ${head_commit} on ${branch}, ${push_reason(state)}`
}

// The last lines of one stream. Split on carriage returns as well as newlines, because a push's
// progress meter and pnpm's spinners overwrite one line with `\r` — counted as a single line, one of
// them alone would fill a tail slot with kilobytes. Escape sequences go for the same reason: this
// text lands in a report that is one line per consumer.
function stream_tail(text: string): string {
	return text
		.replaceAll(ANSI_PATTERN, '')
		.split(LINE_BREAK_PATTERN)
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.slice(-TAIL_LINE_COUNT)
		.join(TAIL_SEPARATOR)
}

// `josh git`'s own last lines, folded onto one. It is the *last* lines that matter, because a hook
// that stops mid-run ends on the check that stopped it — the one fact nothing else in the run keeps.
//
// **Each stream is tailed separately**, and that is not tidiness: git writes its refusal to stderr
// while a hook's own progress commonly goes to stdout, so a tail taken across the two concatenated
// would be all stderr whenever stderr had enough lines — dropping exactly the hook output this
// exists to carry. A synchronous spawn cannot interleave them, so neither is allowed to crowd the
// other out.
function output_tail(streams: ReadonlyArray<string>): string {
	const tails = streams.map((text) => stream_tail(text)).filter((tail) => tail !== '')

	if (tails.length === 0) return ''

	return ` — ${TAIL_LABEL}${tails.join(TAIL_SEPARATOR)}`
}

// What the failure left in the consumer, read from the tree rather than from which step ran. A
// `josh git` that got as far as committing left no uncommitted changes at all, so the standing note
// — the one saying the upgrade and the sync are still sitting there uncommitted — is false exactly
// where this module is reached.
function leftover_note(state: GitStepState): string {
	const parts: Array<string> = []

	if (!state.is_tree_clean) parts.push(UNCOMMITTED)
	if (state.branch !== undefined) parts.push(`the branch ${state.branch}`)
	if (parts.length === 0) return NOTHING_LEFT

	return `${LEFTOVER_LABEL}${parts.join(LEFTOVER_JOIN)}`
}

// The branch `josh git` created, or nothing when the checkout never left its default branch.
function feature_branch(repository_path: string, default_name: string): string | undefined {
	const branch = propagate_git.current_branch(repository_path)

	return branch === undefined || branch === default_name ? undefined : branch
}

// Asked only where there is a commit that could have been pushed. A branch carrying no commit of its
// own was never pushed, and asking anyway would spend two network round trips on a question the
// classification above never reaches.
function read_push_state(
	repository_path: string,
	branch: string | undefined,
	head_commit: string | undefined,
): PushState {
	if (branch === undefined || head_commit === undefined) return NOT_PUSHED

	if (propagate_git.has_remote_branch(repository_path, branch)) {
		return { is_on_remote: true, is_push_hook_blocked: false }
	}

	// The real push has already failed by the time this runs — that is what made the step fail — so a
	// dry run that goes through with the hooks out of the way says the hook is what stopped it. The
	// hook has to exist for that to follow, and the local check is asked first so a consumer with no
	// hook costs no round trip at all.
	return {
		is_on_remote: false,
		is_push_hook_blocked:
			propagate_git.has_pre_push_hook(repository_path) &&
			propagate_git.can_push_without_hooks(repository_path, branch),
	}
}

function read_state(repository_path: string): GitStepState {
	const default_name = propagate_git.default_branch(repository_path)
	const branch = feature_branch(repository_path, default_name)
	const head_commit =
		branch === undefined ? undefined : propagate_git.commit_ahead(repository_path, default_name)

	return {
		branch,
		head_commit,
		is_tree_clean: propagate_git.is_clean(repository_path),
		...read_push_state(repository_path, branch, head_commit),
	}
}

// Replace `josh git`'s bare exit code with the sub-step that produced it, and record what that
// failure left in the consumer. Both are probed from the consumer's own repository, because the exit
// code is the same one whichever of the three sub-steps stopped.
function attribute(
	repository_path: string,
	result: StepResult,
	streams: ReadonlyArray<string>,
): StepResult {
	const state = read_state(repository_path)
	const detail = `${result.detail ?? 'failed'} — ${describe_failure(state)}${output_tail(streams)}`

	return { ...result, detail, leftover: leftover_note(state) }
}

const propagate_git_failure = {
	HOOK_REFUSED,
	NOTHING_LEFT,
	NO_COMMIT,
	NOT_OPENED,
	PUSH_FAILED,
	TAIL_LINE_COUNT,
	UNCOMMITTED,
	attribute,
	describe_failure,
	leftover_note,
	output_tail,
	read_state,
}

export type { GitStepState }
export { propagate_git_failure }
