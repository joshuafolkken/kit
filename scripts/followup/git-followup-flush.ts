import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { issue_cite } from '#scripts/issue/issue-cite'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { observation_ledger_prepare } from '#scripts/observations/observation-ledger-prepare'
import { observations_flush } from '#scripts/observations/observations-flush'

// The residual commit path for the observation ledger. A run's appended lines
// ride its own commit, so the ledger is usually clean by now and this
// short-circuits; what it still catches is a line appended after that commit — an observation
// recorded between the commit and the merge — which would otherwise stay in the working tree after
// the merge. **A passing second review round is not one of them**: it used to
// be the usual case, and its push restarted the pull request's CI on six lanes of fourteen in a day,
// so `review:record --comment` now records that round on the issue and leaves the tree clean.
//
// **It commits onto the pull request's own branch, before the merge**. It used
// to flush after the merge from the default branch, which a lane cannot reach, so a lane's lines
// waited in the primary checkout for a batch-end flush and were lost there to another run's stash.
// Committed to the branch instead, the lines merge with the pull request — in a lane as anywhere — and
// the CI wait `pnpm josh followup` runs next covers the pushed commit like any other push.

const COMMIT_MESSAGE_PREFIX = 'Record observation ledger entries'

function commit_message(issue_number: string | undefined): string {
	return issue_number === undefined
		? COMMIT_MESSAGE_PREFIX
		: `${COMMIT_MESSAGE_PREFIX} ${issue_cite.plain(issue_number)}`
}

// **A broken line refuses the merge rather than riding it**: the branch's
// ledger file goes away with the lane, so a line left behind here is a line lost.
async function assert_grammar(): Promise<void> {
	const broken = await observation_ledger_prepare.prepare(await git_command.repository_root())

	if (broken.length > 0) throw new Error(observations_flush.broken_lines_message(broken))
}

// **A push that fails takes its commit back**, leaving the lines staged: the next `pnpm josh followup`
// then finds them pending and retries. Left committed, they would read as clean and the merge would
// go ahead without them, the lines stranded in a local commit no reader sees.
async function push_or_undo_commit(): Promise<void> {
	try {
		await git_command.push()
	} catch (error) {
		await git_spawn.read(['reset', '--soft', 'HEAD~1'])
		throw error
	}
}

// Only the ledger paths are staged — whatever else the tree holds is the run's to commit, not this
// step's — and `-A` takes a migration's deletion of an old path with it.
async function commit_and_push(
	paths: ReadonlyArray<string>,
	issue_number: string | undefined,
): Promise<void> {
	await git_spawn.read(['add', '-A', '--', ...paths])
	await git_command.commit(commit_message(issue_number))
	await push_or_undo_commit()
}

// **Short-circuits when the ledger holds no pending append**, which is every run that recorded nothing
// after its commit, and on a `--no-merge` run, which has no merge for the lines to ride.
async function commit_ledger_step(
	should_merge: boolean,
	issue_number: string | undefined,
): Promise<void> {
	if (!should_merge) return

	const status_output = await git_command.status()

	if (!observation_ledger.has_pending_append(status_output)) return

	await assert_grammar()

	// Read again: the grammar check migrated any old-path ledger, which changes what is to be staged.
	const paths = observation_ledger
		.ledger_paths(await git_command.status())
		.filter((file_path) => !observation_ledger.is_migration_claim(file_path))

	// A live run's migration claim alone is pending, not a line: with no path, `git add -A --` would
	// stage the whole tree.
	if (paths.length === 0) return

	await commit_and_push(paths, issue_number)
	console.info(
		`💡 Committed ${String(paths.length)} observation ledger path(s) to the pull request.`,
	)
}

const git_followup_flush = { COMMIT_MESSAGE_PREFIX, commit_ledger_step }

export { git_followup_flush }
