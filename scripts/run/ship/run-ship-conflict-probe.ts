import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { git_merge_conflicts } from '#scripts/git/git-merge-conflicts'
import { main_merge_guard } from '#scripts/git/main-merge-guard'
import { main_merge_regenerate } from '#scripts/git/main-merge-regenerate'
import type { StepResult } from './run-ship-sync'

// Before `josh ship --detach` runs its pre-detach checks, whether merging origin/main would stop on a
// conflict (joshuafolkken/kit#5018). The supervisor's sync stage is the first to merge, so a branch
// main had moved under ran the whole pre-detach first and then stopped there, its checks thrown away.
// The reading touches neither the working tree nor the index (`git-merge-conflicts.ts`); only the
// remote-tracking ref of the default branch moves with the fetch. A probe that cannot answer — a fetch
// that failed, a merge base it cannot read — leaves the question to the sync stage, as the sync itself
// leaves a failed fetch to the followup; the ship then runs exactly as it did before the probe.

const FAILURE_EXIT_CODE = 1
const CONFLICT_NOTE = 'merging origin/main would stop on a conflict in:'

// The sync's own order: `main:merge` refuses uncommitted work origin/main also changed, so the commit
// comes first (`main-merge-guard.ts`).
function fix_note(): string {
	return `The pre-detach checks did not run. Commit the work with ${main_merge_guard.commit_command()}, run \`pnpm josh main:merge\`, resolve the conflict in those files, then run the ship again.`
}

async function conflicting_paths(): Promise<ReadonlyArray<string>> {
	const default_branch = await git_command.get_default_branch()

	await git_command.fetch_branch(default_branch)

	const paths = await changed_paths.read_changed_paths(false)
	const root = await git_command.repository_root()

	return git_merge_conflicts.working_tree_conflicts(`origin/${default_branch}`, paths, root) ?? []
}

async function answered_paths(): Promise<ReadonlyArray<string>> {
	try {
		return await conflicting_paths()
	} catch {
		return []
	}
}

// The stop, carrying the paths as the sync stage's conflict does, so the stop is recorded as
// `conflict`; `undefined` when the merge would go through, the sync's merge would resolve every
// conflict itself (`main-merge-regenerate.ts`), or the probe could not tell.
async function probe(): Promise<StepResult | undefined> {
	const conflicts = await answered_paths()

	if (conflicts.length === 0 || main_merge_regenerate.is_resolvable(conflicts)) return undefined

	const out = [CONFLICT_NOTE, ...conflicts, fix_note()].join('\n')

	return { code: FAILURE_EXIT_CODE, out, conflicts }
}

const run_ship_conflict_probe = { CONFLICT_NOTE, probe }

export { run_ship_conflict_probe }
