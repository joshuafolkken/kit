import {
	LEDGER_DIRECTORIES,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	observation_ledger,
} from '#scripts/observations/observation-ledger'
import { observation_ledger_prepare } from '#scripts/observations/observation-ledger-prepare'
import { git_command } from './git-command'
import { git_prompt } from './git-prompt'
import { git_status } from './git-status'

async function confirm_package_json_staged(should_force = false): Promise<boolean> {
	const is_package_json_staged = await git_status.check_package_json_staged()

	if (!is_package_json_staged) {
		if (should_force) {
			console.info('💡 Skipping package.json staging check (force).')

			return false
		}

		await git_prompt.confirm_missing_package_json()

		return false
	}

	return true
}

async function confirm_package_json_version(should_force = false): Promise<void> {
	const is_version_updated = await git_status.check_package_json_version()

	if (is_version_updated) return

	if (should_force) {
		console.info('💡 Skipping package.json version check (force).')

		return
	}

	await git_prompt.confirm_without_version_update()
}

async function check_and_confirm_package_json(should_force = false): Promise<void> {
	const is_already_updated = await git_status.check_branch_version()

	if (is_already_updated) {
		console.info('💡 Version already updated on this branch. Skipping package.json check.')

		return
	}

	const is_staged = await confirm_package_json_staged(should_force)

	if (is_staged) {
		await confirm_package_json_version(should_force)
	}
}

async function stage_untracked_files(files: ReadonlyArray<string>): Promise<void> {
	if (files.length === 0) return

	for (const file of files) {
		// eslint-disable-next-line no-await-in-loop -- git add holds the index lock, so two at once fail
		await git_command.add_path(file)
	}

	console.info(`💡 Auto-staged ${String(files.length)} untracked non-ignored file(s):`)
	for (const file of files) console.info(`   + ${file}`)
}

// **The observation ledger rides the run's own commit**. Committing it separately would cost a
// second branch, CI wait and merge behind every run that appended a line. Staged with the run, the
// lines are reviewed and merged with the pull request whose run recorded them, while CI for that pull
// request is the only wait.
//
// **A line that breaks the grammar keeps the old exclusion**: the commit
// goes ahead without the ledger, and `pnpm josh observations:flush` — which refuses the same line and
// names it — is where it is repaired. The migration is run first, as the flush runs it, so a line
// still on an old path is committed in the directory. **A lane carries its
// own lines**: its writers append to its own tree's issue file, so this is
// the step that takes them to the default branch.
const LEDGER_PATHSPECS: ReadonlyArray<string> = [
	...LEDGER_DIRECTORIES,
	...LEGACY_OBSERVATION_LEDGER_PATHS,
]

async function ledger_exclusions(): Promise<ReadonlyArray<string>> {
	const broken = await observation_ledger_prepare.prepare(await git_command.repository_root())

	return broken.length > 0 ? LEDGER_PATHSPECS : []
}

// An excluded pathspec covers what sits under it, as git reads it — the directory's files included.
function is_excluded(file_path: string, excluded: ReadonlyArray<string>): boolean {
	return excluded.some((spec) => file_path === spec || file_path.startsWith(`${spec}/`))
}

// A migration claim is a copy mid-move, never the ledger itself, so it is never staged.
function is_stageable(file_path: string, excluded: ReadonlyArray<string>): boolean {
	return !observation_ledger.is_migration_claim(file_path) && !is_excluded(file_path, excluded)
}

// **Said out loud, because the alternative is an unexplained failure.** With the ledger the only
// thing changed, `git_status.check_unstaged` still answers true, nothing is staged, and the commit
// step dies on git's empty index with `Failed to commit changes` — a message naming nothing that
// caused it. This line is what turns that into a diagnosis.
//
// **The paths are parsed rather than matched as substrings**: `.josh/observations-old/x.md`
// contains the ledger's path, and a hint naming a file the exclusion never touched is a hint that
// teaches the reader to ignore it.
function report_excluded_paths(status_output: string, excluded: ReadonlyArray<string>): void {
	const left_out = status_output
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => observation_ledger.status_path(line))
		.filter((file_path) => is_excluded(file_path, excluded))

	for (const file_path of left_out) {
		console.info(
			`💡 ${file_path} is not staged: a ledger line breaks the grammar; \`pnpm josh observations:flush\` names it.`,
		)
	}
}

// The status is read after the migration, so an old-path ledger it moved is not staged by its old name.
async function stage_tracked_files(): Promise<void> {
	const excluded = await ledger_exclusions()
	const status_output = await git_command.status()
	const untracked = git_status
		.list_untracked_files(status_output)
		.filter((file_path) => is_stageable(file_path, excluded))

	await git_command.add_tracked(excluded)
	console.info('💡 Auto-staged tracked modified files (git add -u).')
	report_excluded_paths(status_output, excluded)
	await stage_untracked_files(untracked)
}

async function check_and_confirm_staging(should_force = false): Promise<void> {
	const has_unstaged = await git_status.check_unstaged()

	if (has_unstaged) {
		await (should_force ? stage_tracked_files() : git_prompt.confirm_unstaged_files())
	}

	await check_and_confirm_package_json(should_force)
}

const git_staging = {
	check_and_confirm_staging,
}

export { git_staging }
