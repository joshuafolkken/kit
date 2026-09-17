import {
	observation_ledger,
	OBSERVATION_LEDGER_PATH,
} from '#scripts/observations/observation-ledger'
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

	if (!is_version_updated) {
		if (should_force) {
			console.info('💡 Skipping package.json version check (force).')

			return
		}

		await git_prompt.confirm_without_version_update()
	}
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
		await git_command.add_path(file)
	}

	console.info(`💡 Auto-staged ${String(files.length)} untracked non-ignored file(s):`)
	for (const file of files) console.info(`   + ${file}`)
}

// **The observation ledger is never staged by an ordinary commit** (joshuafolkken/kit#1756). A
// parent session appends to it in the primary checkout and nothing there commits it, so the next
// `pnpm josh git` run in that checkout swept the line into a pull request about something else
// entirely — a diff a reviewer has no reason to question. Excluding it here covers every entry
// point, because this is the one staging step all of them go through;
// `pnpm josh observations:flush` is what commits it, on a branch of its own.
const PATHS_EXCLUDED_FROM_STAGING: ReadonlyArray<string> = [OBSERVATION_LEDGER_PATH]

function is_stageable(file_path: string): boolean {
	return !PATHS_EXCLUDED_FROM_STAGING.includes(file_path)
}

// **Said out loud, because the alternative is an unexplained failure.** With the ledger the only
// thing changed, `git_status.check_unstaged` still answers true, nothing is staged, and the commit
// step dies on git's empty index with `Failed to commit changes` — a message naming nothing that
// caused it. This line is what turns that into a diagnosis.
//
// **The paths are parsed rather than matched as substrings**: `docs/observations.md.bak` contains the
// ledger's path, and a hint naming a file the exclusion never touched is a hint that teaches the
// reader to ignore it.
function report_excluded_paths(status_output: string): void {
	const excluded = status_output
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => observation_ledger.status_path(line))
		.filter((file_path) => !is_stageable(file_path))

	for (const file_path of excluded) {
		console.info(`💡 ${file_path} is not staged; commit it with \`pnpm josh observations:flush\`.`)
	}
}

async function stage_tracked_files(): Promise<void> {
	const status_output = await git_command.status()
	const untracked = git_status
		.list_untracked_files(status_output)
		.filter((file_path) => is_stageable(file_path))

	await git_command.add_tracked(PATHS_EXCLUDED_FROM_STAGING)
	console.info('💡 Auto-staged tracked modified files (git add -u).')
	report_excluded_paths(status_output)
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
