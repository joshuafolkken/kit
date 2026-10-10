import { git_gh_pr_read } from '#scripts/gh/git-gh-pr-read'
import { git_command } from '#scripts/git/git-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { json_value } from '#scripts/lib/json-value'
import { run_hold } from '#scripts/run/hold/run-hold'
import { z } from 'zod'

// The preflight check — what an interrupted run left in this working tree, and what the rule says to
// do about it before the next child starts. `run:hold` runs it before it claims the tree, so this
// module is the shared logic behind that claim and behind `run:progress`, not a command of its own.
//
// It is about the run that never said anything again: an unattended run ends abnormally — a crash, a
// Ctrl-C, a laptop asleep, an expired token — and leaves its feature branch, its open pull request and
// its uncommitted changes behind. The next child's checkout refuses over a dirty tree, and an agent
// may not reach for `git stash` on its own judgement, so without this check the batch cannot
// recover unattended.
//
// **The rule answers, so the run does not judge.** "There is a branch already, I will carry on from
// it" and "there is a branch already, I had better stop" are both defensible in the moment, which is
// exactly why the choice is not left to the moment — the same reason `josh delegate` and
// `josh review:level` refuse to leave their answers to an agent.
//
// **The check is re-askable, and so is the claim it now gates — but only by the same run.** A claim
// asked again for the issue the record names answers `hold`; for any other
// issue it answers `busy`, because that ask is a second run. This check reads state and writes nothing,
// so the reclaim recovery ends by asking `run:hold` again on the tree it just cleaned.

const CLEAN_VERDICT = 'clean'
const RECLAIM_VERDICT = 'reclaim'
const RESUME_VERDICT = 'resume'
const PARK_VERDICT = 'park'

type PreflightVerdict =
	typeof CLEAN_VERDICT | typeof PARK_VERDICT | typeof RECLAIM_VERDICT | typeof RESUME_VERDICT

const NO_PR = 'none'
const OPEN_PR = 'open'
const MERGED_PR = 'merged'
const CLOSED_PR = 'closed'

type PrState = typeof CLOSED_PR | typeof MERGED_PR | typeof NO_PR | typeof OPEN_PR

interface TreeState {
	branch: string
	default_branch: string
	is_dirty: boolean
}

interface ChildState {
	branch_name: string | undefined
	pr_state: PrState
}

interface PreflightDecision {
	advice: string
	reason: string
	verdict: PreflightVerdict
}

const NO_CHILD_WORK: ChildState = { branch_name: undefined, pr_state: NO_PR }

// `pr_view` answers with the three fields `to_pr_info` selects; only the state matters here, and it
// is already normalized to upper case by `git-gh-rest-state.ts`, so a lower-case REST spelling never
// reaches this map.
const pr_info_schema = z.object({ state: z.string().optional() })

const GH_PR_STATES: ReadonlyMap<string, PrState> = new Map([
	['CLOSED', CLOSED_PR],
	['MERGED', MERGED_PR],
	['OPEN', OPEN_PR],
])

const CLEAN_REASON =
	'Nothing was left behind: the tree is clean, HEAD is on the default branch, and this issue has no pull request and no branch holding work.'

const CLEAN_ADVICE = 'Start the child.'

const RESUME_ADVICE =
	'Reuse the branch and run the whole verification gate from the start — refactor, `pnpm josh gate`, `/code-review` — never only the part the interrupted run had not reached. Nobody verified what it already committed.'

const PARK_ADVICE =
	'Park the child: add `needs-decision` and comment what was found. Do not delete the branch, do not reopen the pull request, and do not commit on top of it.'

const STASH_LABEL_PREFIX = 'run:hold reclaimed before #'

// The issue number reaches the advice inside a double-quoted shell command a caller is told to paste,
// so the shape it may take is pinned beside the interpolation rather than only in the CLI that
// happens to be today's single caller. `run:liveness` interpolates it the same way, so the pattern
// and the refusal live in one module both read.
const { require_issue_number } = issue_number_shape
const UNREADABLE_PR_MESSAGE = 'The pull request could not be read for branch '

function needs_reclaim(tree: TreeState): boolean {
	return tree.is_dirty || tree.branch !== tree.default_branch
}

// A pull request that was merged or closed is a decision somebody already made. Carrying on over a
// merged one duplicates work that landed; carrying on over a closed one revives work that was
// rejected. Which of those is happening is a person's read, so this is the one verdict that parks.
function is_pr_decided(state: PrState): boolean {
	return state === MERGED_PR || state === CLOSED_PR
}

// **The second clause is `decide`'s contract, not a case `check` produces.** A pull request is only
// ever reached through one of the candidate branches, so a state read from `check` never carries an
// open pull request without the branch it belongs to — and a pull request whose head branch is gone
// from the checkout *and* the remote is outside what this command can see at all, which is what
// `docs/josh-commands.md` says rather than implying coverage the read does not have.
function has_leftover_work(child: ChildState): boolean {
	return child.branch_name !== undefined || child.pr_state === OPEN_PR
}

// The precedence is fixed, and the first row is why it has to be. A `resume` or a `park` decided over
// a dirty tree hands the next child a checkout it cannot switch — so the tree is reclaimed first and
// the question asked again on the clean tree, rather than two answers being merged into one.
function to_verdict(tree: TreeState, child: ChildState): PreflightVerdict {
	if (needs_reclaim(tree)) return RECLAIM_VERDICT

	if (is_pr_decided(child.pr_state)) return PARK_VERDICT

	if (has_leftover_work(child)) return RESUME_VERDICT

	return CLEAN_VERDICT
}

function reclaim_reason(tree: TreeState): string {
	const findings = [
		tree.is_dirty ? 'uncommitted changes' : undefined,
		tree.branch === tree.default_branch ? undefined : `HEAD on ${tree.branch}`,
	].filter((entry): entry is string => entry !== undefined)

	return `An earlier run left ${findings.join(' and ')} in this working tree.`
}

function park_reason(state: PrState): string {
	return `The pull request for this issue is ${state}, so whether any work is still owed is a person's call.`
}

function resume_reason(child: ChildState): string {
	const branch_part = child.branch_name === undefined ? '' : ` on branch ${child.branch_name}`
	const pr_part = child.pr_state === OPEN_PR ? ', and its pull request is still open' : ''

	return `An earlier run left a partial implementation${branch_part}${pr_part}.`
}

function to_reason(verdict: PreflightVerdict, tree: TreeState, child: ChildState): string {
	if (verdict === RECLAIM_VERDICT) return reclaim_reason(tree)

	if (verdict === PARK_VERDICT) return park_reason(child.pr_state)

	if (verdict === RESUME_VERDICT) return resume_reason(child)

	return CLEAN_REASON
}

// **`-u` is not optional.** What an interrupted run leaves almost always includes a new `*.test.ts`,
// which is untracked, and a stash without it leaves exactly those files for the checkout that
// follows to refuse over. **And the stash is recorded rather than popped**, which is what sets this
// stash apart from every other sanctioned one: the work belongs to a run that is gone, so the Issue
// comment is the only thing that can ever bring it back.
//
// **The stash lines appear only over a dirty tree.** `reclaim` also answers a clean checkout parked on
// a feature branch, and printing them there tells the caller to record a stash `git stash push` never
// created — an Issue comment naming nothing, under a rule that says the comment is what restores it.
function reclaim_steps(tree: TreeState, issue: string): Array<string> {
	if (!tree.is_dirty) return []

	return [
		`git stash push -u -m "${STASH_LABEL_PREFIX}${issue}"`,
		`Record the stash on ${session_cite.issue(issue)} — the comment is what gets it popped; nothing pops it for you.`,
	]
}

function reclaim_advice(tree: TreeState, issue: string): string {
	return [
		...reclaim_steps(tree, issue),
		'pnpm josh ms',
		'Then ask this command again: it is re-askable, and the clean tree gets its own answer.',
	].join('\n')
}

function to_advice(verdict: PreflightVerdict, issue: string, tree: TreeState): string {
	if (verdict === RECLAIM_VERDICT) return reclaim_advice(tree, issue)

	if (verdict === RESUME_VERDICT) return RESUME_ADVICE

	if (verdict === PARK_VERDICT) return PARK_ADVICE

	return CLEAN_ADVICE
}

function decide(tree: TreeState, child: ChildState, issue: string): PreflightDecision {
	const verdict = to_verdict(tree, child)

	return {
		advice: to_advice(verdict, issue, tree),
		reason: to_reason(verdict, tree, child),
		verdict,
	}
}

function read_pr_field(raw: string): string | undefined {
	return json_value.parse_with(raw, pr_info_schema)?.state
}

function to_pr_state(raw: string): PrState {
	const state = read_pr_field(raw)

	return (state === undefined ? undefined : GH_PR_STATES.get(state)) ?? NO_PR
}

async function read_tree_state(): Promise<TreeState> {
	const [is_dirty, current, default_branch] = await Promise.all([
		run_hold.is_tree_dirty(),
		git_command.branch(),
		git_command.get_default_branch(),
	])

	return { branch: current, default_branch, is_dirty }
}

// **An unreadable `gh` is not an absent pull request.** `pr_view` folds both into `''` and cannot tell
// them apart, so the existence question is asked through `pr_exists`, which throws on a lookup it
// could not complete. That throw reaches the CLI as `unknown`; without it a
// rate-limited or logged-out `gh` turns a **merged** pull request into `resume`, and the run commits
// on top of work somebody already landed — the exact hazard `park` exists for.
// **The second half of the same guard.** `pr_view` throws on a read it could not complete,
// but the two are separate round trips, so a lookup that answers empty
// between them would still put a **merged** pull request back through `NO_PR` and out as `resume`.
// An empty answer for a branch `pr_exists` has just confirmed is therefore a failed read by
// construction, and it throws rather than answering.
async function read_pr_state(branch_name: string): Promise<PrState> {
	if (!(await git_gh_pr_read.pr_exists(branch_name))) return NO_PR

	const raw = await git_gh_pr_read.pr_view(branch_name)

	if (raw === '') throw new Error(`${UNREADABLE_PR_MESSAGE}${branch_name}`)

	return to_pr_state(raw)
}

function is_pr_open(state: PrState): boolean {
	return state === OPEN_PR
}

async function read_pr_of_branch(branch_name: string): Promise<ChildState> {
	return { branch_name, pr_state: await read_pr_state(branch_name) }
}

// **A decided pull request on any candidate branch outranks an open one on another.** An interrupted
// run can leave more than one branch for an issue — a retry beside the original — and reading only
// whichever git lists first hides a merged pull request behind a branch that has none. **The branch
// reported is the one that produced the winning state**, so the reason never names branch A while the
// verdict came from branch B's pull request.
function pick_child_state(reads: ReadonlyArray<ChildState>): ChildState {
	const decided = reads.find((read) => is_pr_decided(read.pr_state))
	const open = reads.find((read) => is_pr_open(read.pr_state))

	return decided ?? open ?? { branch_name: reads[0]?.branch_name, pr_state: NO_PR }
}

// `git branch --list` takes a glob, so the branch is found without knowing its slug: `pnpm josh git`
// builds `<N>-<slug>` (`scripts/git/git-issue.ts` → `create_branch_name`), and `<N>-*` matches it
// whatever the title was, while never matching `<N><digit>-…`.
//
// **Remote-tracking branches are searched too**, and the remote name is stripped back off, because the
// pull request is keyed by its head branch: a run interrupted on another machine — or in a checkout
// since re-cloned — leaves the branch on the remote with no local counterpart, and searching locally
// alone would answer `clean` over an open pull request.
const ISSUE_BRANCH_SUFFIX = '-*'
const ANY_REMOTE_PREFIX = '*/'
const REMOTE_SEPARATOR = '/'
const NOT_FOUND_INDEX = -1

function to_head_branch(name: string): string {
	const separator_index = name.indexOf(REMOTE_SEPARATOR)

	return separator_index === NOT_FOUND_INDEX ? name : name.slice(separator_index + 1)
}

function group_by_head(pairs: ReadonlyArray<[string, string]>): Map<string, Array<string>> {
	const groups = new Map<string, Array<string>>()

	for (const [name, reference] of pairs) groups.set(name, [...(groups.get(name) ?? []), reference])

	return groups
}

// Each candidate keeps every ref it was found as — the local branch and each remote-tracking ref —
// because either may be the one holding the commits: a local branch left at the default branch can
// sit beside a remote one another machine pushed work to, and the stripped head name may not resolve.
async function read_branch_candidates(issue: string): Promise<Map<string, Array<string>>> {
	const pattern = `${issue}${ISSUE_BRANCH_SUFFIX}`
	const [local, remote] = await Promise.all([
		git_command.branch_names(pattern),
		git_command.branch_names_remote(`${ANY_REMOTE_PREFIX}${pattern}`),
	])

	return group_by_head([
		...local.map((name): [string, string] => [name, name]),
		...remote.map((reference): [string, string] => [to_head_branch(reference), reference]),
	])
}

async function has_commits_beyond(
	base: string,
	references: ReadonlyArray<string>,
): Promise<boolean> {
	const counts = await Promise.all(
		references.map(async (reference) => await git_command.commit_count_beyond(base, reference)),
	)

	return counts.some((count) => count > 0)
}

// **A lane stopped mid-implementation holds its work uncommitted**, on a branch with no commit yet —
// so the lane checked out on the candidate is asked whether its tree is dirty, read the way
// `run_hold` reads this tree (an unreadable status is dirty). A lane on another branch, or whose
// directory is gone, holds nothing for this candidate.
async function is_held_dirty(name: string, lane: LaneInfo | undefined): Promise<boolean> {
	if (lane?.branch !== name || lane.is_stranded) return false

	return await run_hold.is_tree_dirty(lane.directory)
}

interface CandidateContext {
	base: string
	lane: LaneInfo | undefined
}

// **A branch with no pull request, no commit beyond the default branch and no uncommitted change in
// its lane holds no work**. A lane that ended before implementing — an operational issue with no code
// change — leaves exactly that behind, and reading its mere existence as a partial implementation
// would send the next `fullrun #N` to `resume` over nothing. A branch with a
// pull request is never counted: whatever its commits, the pull request is the state the verdict is
// decided on.
async function read_candidate(
	name: string,
	references: ReadonlyArray<string>,
	context: CandidateContext,
): Promise<ChildState | undefined> {
	const state = await read_pr_of_branch(name)

	if (state.pr_state !== NO_PR) return state
	if (await has_commits_beyond(context.base, references)) return state

	return (await is_held_dirty(name, context.lane)) ? state : undefined
}

async function read_child_state(issue: string): Promise<ChildState> {
	const candidates = await read_branch_candidates(issue)

	if (candidates.size === 0) return NO_CHILD_WORK

	const [base, lane] = await Promise.all([
		git_command.default_branch_reference(),
		lane_registry.find_open_lane(issue),
	])
	const reads = await Promise.all(
		[...candidates].map(
			async ([name, references]) => await read_candidate(name, references, { base, lane }),
		),
	)

	return pick_child_state(reads.filter((read): read is ChildState => read !== undefined))
}

// The child read is skipped where the tree already answers `reclaim`: a `gh` round trip buys nothing
// there, because the verdict would be `reclaim` whatever it said, and the recovery ends by asking
// this command again on the clean tree.
async function check(issue: string): Promise<PreflightDecision> {
	require_issue_number(issue)

	const tree = await read_tree_state()

	if (needs_reclaim(tree)) return decide(tree, NO_CHILD_WORK, issue)

	return decide(tree, await read_child_state(issue), issue)
}

const run_preflight = {
	CLEAN_VERDICT,
	RESUME_ADVICE,
	MERGED_PR,
	STASH_LABEL_PREFIX,
	check,
	decide,
	read_child_state,
	read_pr_state,
	to_pr_state,
}

export type { ChildState, PreflightDecision, PreflightVerdict, PrState, TreeState }
export { run_preflight }
