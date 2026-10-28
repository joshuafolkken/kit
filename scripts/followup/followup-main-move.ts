import { git_command } from '#scripts/git/git-command'
import { main_merge_guard } from '#scripts/git/main-merge-guard'
import type { ObservationEntry } from '#scripts/observations/observation-record'
import { followup_failed_tests } from './followup-failed-tests'

// **A test red outside the change that main has since changed is merged, not rerun**
// (joshuafolkken/kit#5316): a date-bound test fixed on main went red on a lane still on the old base,
// and the rerun on that base was red again before `merge_again` (`run-ship-sync.ts`) took main in. So
// before a rerun, a failed test whose file or subject module (`followup_failed_tests.subjects_of`) main
// moved since the branch point skips it: `followup` fails as before and ship's merge, gate and push go
// first. The rerun right is unspent, and after the merge the same file is no longer incoming, so a
// test still red is rerun once as before.

const OBSERVATION_SLUG = 'followup-main-merge-first'
const OBSERVATION_DEPTH = 'd1'
const LATEST_COMMIT = 1
const SHORT_SHA_LENGTH = 12

interface MainMove {
	files: ReadonlyArray<string>
	commit: string
}

function moved_files(
	test_files: ReadonlyArray<string>,
	incoming: ReadonlySet<string>,
): Array<string> {
	return test_files.filter((file) =>
		followup_failed_tests.subjects_of(file).some((subject) => incoming.has(subject)),
	)
}

// The main-side commit is the latest on main's own line that touched the first moved file.
async function latest_commit(file: string, main_reference: string): Promise<string> {
	const [commit] = await git_command.log_first_parent(LATEST_COMMIT, file, main_reference)

	return commit ?? main_reference
}

// **The failed test files main moved since the branch point**, `undefined` when main did not move or
// moved none of them. The fetch is what makes `origin/<default>` current, as `main_merge.merge` does.
async function read_main_move(test_files: ReadonlyArray<string>): Promise<MainMove | undefined> {
	if (test_files.length === 0) return undefined

	const default_branch = await git_command.get_default_branch()

	await git_command.fetch_branch(default_branch)

	const incoming = new Set(await main_merge_guard.incoming_paths(default_branch))
	const files = moved_files(test_files, incoming)
	const [first] = files

	if (first === undefined) return undefined

	return { files, commit: await latest_commit(first, `origin/${default_branch}`) }
}

function observation_of(move: MainMove): ObservationEntry {
	return {
		slug: OBSERVATION_SLUG,
		depth: OBSERVATION_DEPTH,
		where: move.files.join(', '),
		what: `followup put the main merge before the rerun; the failed test moved on main at ${move.commit.slice(0, SHORT_SHA_LENGTH)}`,
	}
}

// A fetch or read that fails is reported and keeps the rerun: the merge is the shortcut, the rerun the
// recovery that stood before it.
async function read_or_rerun(test_files: ReadonlyArray<string>): Promise<MainMove | undefined> {
	try {
		return await read_main_move(test_files)
	} catch (error) {
		console.info(`⚠️ Could not compare the failed tests with main, rerunning: ${String(error)}`)

		return undefined
	}
}

// **Whether the rerun is skipped for a merge of main**, with the reason posted on the issue.
async function should_merge_first(
	test_files: ReadonlyArray<string>,
	issue: number | undefined,
): Promise<boolean> {
	const move = await read_or_rerun(test_files)

	if (move === undefined) return false

	console.info(
		`🔀 Not rerunning: main changed the failed tests since the branch point (${move.files.join(', ')}); merge main first.`,
	)
	await followup_failed_tests.record_entry(observation_of(move), issue)

	return true
}

const followup_main_move = {
	read_main_move,
	should_merge_first,
}

export type { MainMove }
export { followup_main_move, OBSERVATION_SLUG }
