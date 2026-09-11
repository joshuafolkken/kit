import { git_command } from '#scripts/git/git-command'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_pr_checks } from '#scripts/git/git-pr-checks'
import { main_sync } from '#scripts/git/main-sync'
import { observation_ledger, OBSERVATION_LEDGER_PATH } from './observation-ledger'

// The commit path the observation ledger did not have (joshuafolkken/kit#1756). The parent session
// that appends a line never runs `pnpm josh git`; a child runs it inside a lane work tree, which
// cannot see the parent's checkout at all; and in the primary checkout `git add -u` swept the line
// into whatever unrelated pull request that run was opening. So the ledger is excluded from ordinary
// staging (`scripts/git/git-staging.ts`) and this is the one thing that stages it.
//
// **The shape is `scripts/release/release-publish.ts`'s, deliberately.** Both open a pull request of
// their own over one path, wait on the same required checks every other pull request waits on, and
// merge — so this reuses the same primitives rather than growing a second answer to "how does a
// josh command open and land a pull request".

const COMMIT_MESSAGE = 'Record observation ledger entries'
const CLEAN_MESSAGE = `clean — ${OBSERVATION_LEDGER_PATH} matches the commit it sits on, so there is nothing to flush`
const BRANCH_PREFIX = 'observations/'
const SUCCESS_EXIT_CODE = 0
const RETURN_FAILURE_MESSAGE =
	'Could not return this checkout to the default branch; `pnpm josh ms` printed the reason above.'
const DATE_END = 10
const TIME_START = 11
const TIME_END = 19
const COLON = ':'
const NO_COMMITS = 0

// **A count that could not be read is treated as "it may hold a commit".** Of the two refusals below
// it chooses the one that warns about the only copy, because printing "nothing is stranded" on a
// branch nobody could measure is the answer that loses lines.
const UNKNOWN_COMMIT_COUNT = 1

// **Stamped to the second rather than to the minute.** A flush that fails after its commit leaves the
// branch behind, and a retry inside the same clock unit would die on git's raw `a branch named …
// already exists` instead of the message below — so the unit is the one a person cannot retry
// inside.
function timestamp_for(now: Date): string {
	const iso = now.toISOString()

	return `${iso.slice(0, DATE_END)}-${iso.slice(TIME_START, TIME_END).replaceAll(COLON, '')}`
}

function branch_name_for(stamp: string): string {
	return `${BRANCH_PREFIX}${stamp}`
}

// **No `closes #N`.** A flush carries whatever observations the last cycle recorded; it answers to no
// single issue, and the ledger's own lines say where each one was seen.
function pull_request_body(): string {
	return [
		`Appended observations from \`${OBSERVATION_LEDGER_PATH}\`, which \`pnpm josh git\` never stages.`,
		'',
		'The ledger is append-only, and a second line under one key is what promotes an observation to an issue — so this pull request adds lines and changes none.',
		'',
		'Opened by `pnpm josh observations:flush` (joshuafolkken/kit#1756).',
	].join('\n')
}

function status_paths(status_output: string): ReadonlyArray<string> {
	return status_output
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => observation_ledger.status_path(line))
}

function has_ledger_change(status_output: string): boolean {
	return status_paths(status_output).includes(OBSERVATION_LEDGER_PATH)
}

function other_changed_paths(status_output: string): ReadonlyArray<string> {
	return status_paths(status_output).filter((file_path) => file_path !== OBSERVATION_LEDGER_PATH)
}

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

// **The branch a failed flush leaves behind holds the only copy of those lines**, because the working
// tree no longer shows them once they are committed. Sending a person to `pnpm josh ms` here — which
// is what the ordinary off-default refusal says — would abandon them without a word, so this branch
// of the refusal says the opposite.
//
// **The exits it names are ones the caller can actually take** (joshuafolkken/kit#1785). It used to
// say "finish or delete that branch", and both are closed to an agent: the distributed
// `.claude/settings.json` denies `Bash(git commit*)` and `Bash(git branch -d*)`, and `pnpm josh git`
// excludes the ledger from staging by design (joshuafolkken/kit#1756), so finishing through it is not
// possible either. Pushing the branch and landing its pull request is the route that is open.
function stranded_flush_message(current: string): string {
	return `\`${current}\` is a flush branch an earlier \`pnpm josh observations:flush\` left behind, and its appended observations are committed only there. Land it before flushing again — \`git push -u origin ${current}\`, then open and merge its pull request; \`pnpm josh ms\` here would leave the only copy of those lines behind.`
}

// **A flush branch with no commit on it strands nothing, so it is told the opposite**
// (joshuafolkken/kit#1785). The appended lines never left the working tree, which makes the "only
// copy" premise above factually false here — and makes `pnpm josh ms` the correct exit, the very one
// the other message forbids.
function empty_flush_message(current: string): string {
	return `\`${current}\` is a flush branch an earlier \`pnpm josh observations:flush\` left behind with no commit on it, so nothing is stranded: the appended observations are still in this working tree. Run \`pnpm josh ms\` and flush again — that cuts a fresh branch and loses no line, leaving \`${current}\` as an empty branch to clear whenever it suits you.`
}

function flush_branch_message(current: string, commit_count: number): string {
	return commit_count === NO_COMMITS
		? empty_flush_message(current)
		: stranded_flush_message(current)
}

// **Two refusals rather than one taking a count it may not use.** Only the flush-branch arm reads a
// commit count, so the ordinary off-default refusal is a function of its own and
// `refuse_off_default` below spawns `git rev-list` for the arm that needs it alone.
function off_default_message(current: string, default_branch: string): string {
	return `\`pnpm josh observations:flush\` opens a branch of its own, so it starts from \`${default_branch}\` — this checkout is on \`${current}\`. Run \`pnpm josh ms\` first.`
}

function is_flush_branch(current: string): boolean {
	return current.startsWith(BRANCH_PREFIX)
}

// **The rollback has already run, so this says what is now true rather than what to go and do.** The
// checkout is back on the default branch, the branch is gone, and the appended lines are where they
// always were — so the next attempt is this same command, once whatever rejected the commit is fixed.
function rejected_commit_message(branch_name: string, reason: string): string {
	return `The ledger's commit was rejected, so \`${branch_name}\` was removed and this checkout is back on the default branch: ${reason} — the appended observations are still in the working tree. Fix what was rejected and run \`pnpm josh observations:flush\` again.`
}

// **The rollback did not finish, so nothing here claims the branch is gone.** The message above
// would assert a removal that did not happen, which is worse than saying nothing: it is what sends
// somebody looking for a branch that is still sitting in the checkout. Both reasons are carried in
// the one error the command exits with rather than one of them being printed above it.
//
// **"Nothing was committed to it" is traceable rather than measured** — the commit that would have
// put something there is the one that was just rejected — so the exit is `empty_flush_message`'s,
// which is also the refusal the next run will print.
function roll_back_failure_message(
	branch_name: string,
	reason: string,
	roll_back_reason: string,
): string {
	return `The ledger's commit was rejected and \`${branch_name}\` could not be cleaned up afterwards. The commit was rejected by: ${reason}. The cleanup failed with: ${roll_back_reason}. Nothing was committed to that branch and the appended observations are still in the working tree, so \`pnpm josh ms\` followed by another flush loses no line.`
}

// **A tree holding anything else is somebody's work in progress**, and a flush that carried it would
// be the contamination this command exists to end, pointing the other way.
function other_changes_message(paths: ReadonlyArray<string>): string {
	return `The working tree holds changes besides the ledger, so \`pnpm josh observations:flush\` stops rather than committing them: ${paths.join(', ')}`
}

// One message for every failure after the commit, because they all leave the same thing behind: the
// appended lines committed on the flush branch and nowhere the working tree can show them. The
// checkout is deliberately left on that branch, so the refusal above fires on the next attempt.
function stranded_branch_message(branch_name: string, reason: string): string {
	return `The ledger is committed on \`${branch_name}\` and the flush then failed: ${reason} — those lines now exist only on that branch, and this checkout is still on it. Finish that branch's pull request before running \`pnpm josh ms\` here.`
}

async function commits_beyond(base: string, tip: string): Promise<number> {
	try {
		return await git_command.commit_count_beyond(base, tip)
	} catch {
		return UNKNOWN_COMMIT_COUNT
	}
}

async function refuse_off_default(current: string, default_branch: string): Promise<never> {
	if (!is_flush_branch(current)) throw new Error(off_default_message(current, default_branch))

	throw new Error(flush_branch_message(current, await commits_beyond(default_branch, current)))
}

// Returns the default branch, which is what the rollback below checks out again.
async function refuse_unsafe_flush(status_output: string): Promise<string> {
	const current = await git_command.branch()
	const default_branch = await git_command.get_default_branch()

	if (current !== default_branch) await refuse_off_default(current, default_branch)

	const others = other_changed_paths(status_output)

	if (others.length > 0) throw new Error(other_changes_message(others))

	return default_branch
}

// **`main_sync.run` rather than a third copy of its three lines.** `pnpm josh ms` and
// `pnpm josh release`'s own `finally` already spell out "read the default branch, check it out, pull
// it", and writing it again here would be the clone `CLAUDE.md` prohibits. Reusing the command also
// brings its refusal inside a linked work tree, which is a precondition this flush wants anyway.
//
// **Its exit code is read rather than discarded**: `run` catches its own errors and returns `1`, so a
// checkout left on the flush branch would otherwise be reported as a completed flush.
async function return_to_default_branch(): Promise<void> {
	const exit_code = await main_sync.run([])

	if (exit_code !== SUCCESS_EXIT_CODE) throw new Error(RETURN_FAILURE_MESSAGE)
}

// Everything after the commit, so a failure here can say what is on the branch and what it costs to
// walk away from it.
async function push_and_open(branch_name: string): Promise<string> {
	try {
		await git_command.push()

		return await git_gh_command.pr_create(COMMIT_MESSAGE, pull_request_body())
	} catch (error) {
		throw new Error(stranded_branch_message(branch_name, message_of(error)), { cause: error })
	}
}

// **The side that created the branch is the side that rolls it back** (joshuafolkken/kit#1785). A
// commit rejected by the pre-commit hook used to leave the branch behind with nothing on it, and the
// refusal the next run printed named two exits an agent cannot take. Nothing is stranded at this
// point — the appended lines are still in the working tree, staged and uncommitted — so returning to
// the default branch and removing the branch loses none of them.
//
// **Its own failure is returned rather than thrown or printed**, so the single error the command
// exits with can carry both facts — why the commit was rejected, and whether the branch is still
// there. Printed above the throw it scrolled past the message that mattered; thrown over it, the
// reason for the rejection was lost outright. `undefined` means the rollback finished.
async function roll_back(branch_name: string, default_branch: string): Promise<string | undefined> {
	try {
		await git_command.checkout(default_branch)
		await git_command.delete_branch(branch_name)

		return undefined
	} catch (error) {
		return message_of(error)
	}
}

// **The message is chosen from what the rollback did, never assumed.** A rollback that could not
// check the default branch out leaves the branch exactly where it was, and a message asserting its
// removal would send somebody looking for something that is still in the checkout.
function rejection_message(
	branch_name: string,
	reason: string,
	roll_back_reason: string | undefined,
): string {
	if (roll_back_reason === undefined) return rejected_commit_message(branch_name, reason)

	return roll_back_failure_message(branch_name, reason, roll_back_reason)
}

async function commit_ledger(branch_name: string, default_branch: string): Promise<void> {
	try {
		await git_command.add_path(OBSERVATION_LEDGER_PATH)
		await git_command.commit(COMMIT_MESSAGE)
	} catch (error) {
		const roll_back_reason = await roll_back(branch_name, default_branch)

		throw new Error(rejection_message(branch_name, message_of(error), roll_back_reason), {
			cause: error,
		})
	}
}

async function open_pull_request(branch_name: string, default_branch: string): Promise<string> {
	await git_command.checkout_b(branch_name)
	await commit_ledger(branch_name, default_branch)

	return await push_and_open(branch_name)
}

// **The checkout goes back to the default branch only on the way that merged.** A `finally` here
// would check the default branch out after a red check too — and `docs/observations.md` would then
// revert to main's content, leaving the appended lines on a branch nothing in this checkout points
// at any more. The next flush would read `has_ledger_change` as false and report `clean`, which is
// the silent loss the refusals above exist to prevent. Left on the branch, the refusal fires.
async function land(branch_name: string): Promise<void> {
	try {
		await git_pr_checks.wait_for_pr_success(branch_name)
		await git_gh_command.pr_merge(branch_name)
	} catch (error) {
		throw new Error(stranded_branch_message(branch_name, message_of(error)), { cause: error })
	}

	await return_to_default_branch()
}

function merged_message(branch_name: string): string {
	return `merged \`${branch_name}\` — the appended observations are on the default branch`
}

// **Nothing pulls in front of the branch, and that is deliberate.** The ledger is dirty by
// definition at this point, so `git pull --ff-only` aborts on it in exactly the case a pull would
// have been for — an upstream flush that already advanced the ledger — and reports a failure about
// the wrong thing. A flush cut from a default branch that predates another merged flush therefore
// still opens a pull request that conflicts; joshuafolkken/kit#1768 carries that.
async function flush(now: Date): Promise<string> {
	const status_output = await git_command.status()
	const default_branch = await refuse_unsafe_flush(status_output)

	if (!has_ledger_change(status_output)) return CLEAN_MESSAGE

	const branch_name = branch_name_for(timestamp_for(now))

	console.info(await open_pull_request(branch_name, default_branch))
	await land(branch_name)

	return merged_message(branch_name)
}

const observations_flush = {
	branch_name_for,
	CLEAN_MESSAGE,
	COMMIT_MESSAGE,
	empty_flush_message,
	flush,
	flush_branch_message,
	has_ledger_change,
	merged_message,
	off_default_message,
	other_changed_paths,
	other_changes_message,
	pull_request_body,
	rejected_commit_message,
	roll_back_failure_message,
	stranded_branch_message,
	timestamp_for,
}

export { observations_flush }
