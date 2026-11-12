import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_pr_checks } from '#scripts/gh/git-pr-checks'
import { git_command } from '#scripts/git/git-command'
import { main_sync } from '#scripts/git/main-sync'
import { IGNORE_FOR_RELEASE_LABEL } from '#scripts/issue/issue-labels'
import { error_text } from '#scripts/lib/error-message'
import { review_comment_carry } from '#scripts/review/review-comment-carry'
import { observation_ledger, OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'
import { observation_ledger_archive } from './observation-ledger-archive'
import type { BrokenLine } from './observation-ledger-line'
import { observation_ledger_prepare } from './observation-ledger-prepare'
import { observations_flush_landing } from './observations-flush-landing'
import { observations_flush_transaction } from './observations-flush-transaction'

// The commit path for the ledger lines no run's own commit carried. Every run —
// a lane's included — commits its appended lines with its own pull request (`scripts/git/
// git-staging.ts`), and `pnpm josh followup` commits a
// line appended after that commit before it merges, so what is left here is a line written on the
// default branch outside any issue's run — the date-named file `observation-ledger-home.ts` resolves —
// and the closed issues' comment rounds no lane carries (`flush` below).
//
// **The shape is `scripts/release/release-publish.ts`'s, deliberately.** Both open a pull request of
// their own over one path, wait on the same required checks every other pull request waits on, and
// merge — so this reuses the same primitives rather than growing a second answer to "how does a
// josh command open and land a pull request". The one difference is that this pull request is handed
// to GitHub's auto-merge as soon as it opens, so it lands even when the wait
// below does not survive — `observations-flush-landing.ts` carries why.

const COMMIT_MESSAGE = 'Record observation ledger entries'
const CLEAN_MESSAGE = `clean — ${OBSERVATION_LEDGER_DIRECTORY} matches the commit it sits on, so there is nothing to flush`
const BRANCH_PREFIX = 'observations/'
const SUCCESS_EXIT_CODE = 0
const RETURN_FAILURE_MESSAGE =
	'Could not return this checkout to the default branch; `pnpm josh ms` printed the reason above.'
const DATE_END = 10
const TIME_START = 11
const TIME_END = 19
const COLON = ':'
const NO_COMMITS = 0
const NO_ARCHIVED_FILES = 0

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
//
// **A flush that archived says it moved lines** (joshuafolkken/kit#7336): "changes none" would be
// false of the removed files, so it says what holds instead — every line moved, none dropped.
function ledger_change_sentence(archived_files: number): string {
	if (archived_files === NO_ARCHIVED_FILES) {
		return 'so this pull request adds lines and changes none.'
	}

	return `so this pull request drops none: it adds lines, and moves ${String(archived_files)} closed issues' file(s) verbatim into the monthly \`archive-YYYY-MM.md\` files.`
}

function pull_request_body(archived_files: number): string {
	return [
		`Appended observations from \`${OBSERVATION_LEDGER_DIRECTORY}\` that no run's own commit carried.`,
		'',
		`The ledger is append-only, and a second line under one key is what promotes an observation to an issue — ${ledger_change_sentence(archived_files)}`,
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

// **Single-sourced with `pnpm josh followup`'s pre-flush short-circuit**:
// the ledger-change test lives in `observation-ledger.ts`, so the two callers cannot drift.
function has_ledger_change(status_output: string): boolean {
	return observation_ledger.has_pending_append(status_output)
}

function other_changed_paths(status_output: string): ReadonlyArray<string> {
	return status_paths(status_output).filter(
		(file_path) => !observation_ledger.is_ledger_path(file_path),
	)
}

// **The branch a failed flush leaves behind holds the only copy of those lines**, because the working
// tree no longer shows them once they are committed. Sending a person to `pnpm josh ms` here — which
// is what the ordinary off-default refusal says — would abandon them without a word, so this branch
// of the refusal says the opposite.
//
// **The exits it names are ones the caller can actually take**. "Finish or delete that branch" are
// both closed to an agent: the distributed
// `.claude/settings.json` denies `Bash(git commit*)` and `Bash(git branch -d*)`, and `pnpm josh git`
// excludes the ledger from staging by design, so finishing through it is not
// possible either. Pushing the branch and landing its pull request is the route that is open.
function stranded_flush_message(current: string): string {
	return `\`${current}\` is a flush branch an earlier \`pnpm josh observations:flush\` left behind, and its appended observations are committed only there. Land it before flushing again — \`git push -u origin ${current}\`, then open and merge its pull request; \`pnpm josh ms\` here would leave the only copy of those lines behind.`
}

// **A flush branch with no commit on it strands nothing, so it is told the opposite**.
// The appended lines never left the working tree, which makes the "only
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

// **A branch cut from a default branch that predates another merged flush conflicts by
// construction**. The ledger is append-only and every writer adds at the
// same tail, so a stale start point opens a pull request `wait_for_pr_success` waits on until it
// exhausts its budget rather than merging. The flush fast-forwards first, so
// this is printed only when that fast-forward was refused — the reason is git's own.
function behind_default_message(default_branch: string, reason: string): string {
	return `\`pnpm josh observations:flush\` cuts its branch from \`${default_branch}\`, which is behind \`origin/${default_branch}\` and could not be fast-forwarded (${reason}) — a branch cut here would open a pull request that cannot merge. Run \`pnpm josh ms\` first.`
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

// **The start point's freshness is judged without moving the working tree**, which is the whole
// point of doing it here rather than pulling. `git fetch` updates the
// remote-tracking ref and `git rev-list --count HEAD..origin/<default>` reads it — neither writes a
// file, so the ledger, dirty by definition when this runs, is left exactly as it is.
async function commits_behind_default(default_branch: string): Promise<number> {
	await git_command.fetch_branch(default_branch)

	return await git_command.commit_count_beyond('HEAD', `origin/${default_branch}`)
}

// **A default branch that is only behind is brought forward rather than refused**.
// A lane's flush acts on the primary checkout, whose default branch is
// behind by the lane's own merge every time — so the refusal alone stopped every lane close. A
// `--ff-only` merge moves no file the dirty ledger conflicts with: git refuses it, untouched, when an
// incoming commit changes the ledger too, and only that case is still refused.
async function catch_up_default(default_branch: string): Promise<void> {
	if ((await commits_behind_default(default_branch)) === NO_COMMITS) return

	try {
		await git_command.merge_fast_forward(default_branch)
	} catch (error) {
		throw new Error(behind_default_message(default_branch, error_text.message_of(error)), {
			cause: error,
		})
	}
}

// Refuse another person's work before creating the isolated flush checkout.
async function refuse_unsafe_flush(status_output: string): Promise<string> {
	const current = await git_command.branch()
	const default_branch = await git_command.get_default_branch()

	if (current !== default_branch) await refuse_off_default(current, default_branch)

	const others = other_changed_paths(status_output)

	if (others.length > 0) throw new Error(other_changes_message(others))

	return default_branch
}

// The source stayed on the default branch; main:sync owns its fast-forward and exit status.
async function return_to_default_branch(default_branch: string): Promise<void> {
	if ((await git_command.branch()) !== default_branch) throw new Error(RETURN_FAILURE_MESSAGE)
	const exit_code = await main_sync.run([])

	if (exit_code !== SUCCESS_EXIT_CODE) throw new Error(RETURN_FAILURE_MESSAGE)
}

// Publication failures retain the isolated commit and the source records for retry.
async function push_and_open(branch_name: string, body: string): Promise<string> {
	try {
		await git_command.push()

		return await git_gh_command.pr_create(COMMIT_MESSAGE, body, IGNORE_FOR_RELEASE_LABEL)
	} catch (error) {
		throw new Error(
			`The ledger is committed on \`${branch_name}\` in the recovery worktree; publication failed: ${error_text.message_of(error)}. The source checkout and original records are preserved. Rerun \`pnpm josh observations:flush\` from the source checkout to resume.`,
			{ cause: error },
		)
	}
}

function merged_message(branch_name: string): string {
	return `merged \`${branch_name}\` — the appended observations are on the default branch`
}

function broken_lines_message(broken: ReadonlyArray<BrokenLine>): string {
	const rows = broken.map((entry) => `  ${entry.line}\n    ↳ ${entry.reason}`).join('\n')

	return `\`${OBSERVATION_LEDGER_DIRECTORY}\` has ${String(broken.length)} line(s) that break the ledger grammar, so the ledger commit stops rather than carrying them:\n${rows}`
}

// Validate the isolated payload before staging it.
async function prepare_ledger(): Promise<void> {
	const broken = await observation_ledger_prepare.prepare(process.cwd())

	if (broken.length > 0) throw new Error(broken_lines_message(broken))
}

// Recovery must precede a freshness check: an already landed archive can conflict with the snapshot.
async function ready_default_branch(status_output: string): Promise<string> {
	const default_branch = await refuse_unsafe_flush(status_output)

	if (status_output.split('\n').some((line) => /^[^ ?]/u.test(line))) {
		throw new Error(
			'Staged changes must be committed or unstaged before observations:flush; index left untouched',
		)
	}

	if (!(await observations_flush_transaction.pending(process.cwd()))) {
		await catch_up_default(default_branch)
	}

	return default_branch
}

// Partial archival must throw: the transaction rebuilds it from its durable snapshot on retry.
async function carried_status(): Promise<{ status_output: string; archived_files: number }> {
	await review_comment_carry.carry_reported(process.cwd())

	const archived_files = await observation_ledger_archive.archive(process.cwd())

	return { status_output: await git_command.status(), archived_files }
}

// Carry, migration and archival run only in the isolated checkout.
async function prepare_isolated(): Promise<number> {
	const { archived_files } = await carried_status()

	await prepare_ledger()

	return archived_files
}

async function publish_isolated(branch_name: string, archived_files: number): Promise<void> {
	if ((await git_pr_checks.read_merge_progress(branch_name)) === 'merged') return
	const open = await git_gh_command.pr_list_open_with_head_prefix(branch_name)

	if (open.length === 0) {
		console.info(await push_and_open(branch_name, pull_request_body(archived_files)))
	}

	const is_auto_merge = await observations_flush_landing.request_auto_merge(branch_name)

	await observations_flush_landing.wait_for_landing(branch_name, is_auto_merge)
}

async function flush(now: Date): Promise<string> {
	const default_branch = await ready_default_branch(await git_command.status())
	const is_pending = await observations_flush_transaction.pending(process.cwd())
	const deferred = is_pending
		? undefined
		: await observations_flush_landing.refuse_open_flush(BRANCH_PREFIX)
	if (deferred !== undefined) return deferred
	const branch_name = branch_name_for(timestamp_for(now))

	const committed_branch = await observations_flush_transaction.run(process.cwd(), branch_name, {
		prepare: prepare_isolated,
		publish: publish_isolated,
	})
	if (committed_branch === '') return CLEAN_MESSAGE
	await return_to_default_branch(default_branch)

	return merged_message(committed_branch)
}

const observations_flush = {
	behind_default_message,
	branch_name_for,
	broken_lines_message,
	CLEAN_MESSAGE,
	COMMIT_MESSAGE,
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
