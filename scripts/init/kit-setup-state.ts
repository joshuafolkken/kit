import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { start_exec } from './start-exec'

const START_HINT =
	'To use the GitHub Issue workflow, run pnpm exec josh start next: it puts this setup on GitHub, through a pull request when main already has commits.'

// Whether the commit checked out records kit in its manifest — the sign that kit's setup has already
// reached the branch, so `josh start` has no setup pull request to open.
function is_kit_committed(root: string): boolean {
	// `./` resolves the path from `root` rather than from the repository's top level.
	const manifest = start_exec.git_read(['show', 'HEAD:./package.json'], root)

	return manifest?.includes(`"${KIT_PACKAGE_NAME}"`) ?? false
}

function is_git_work_tree(root: string): boolean {
	return start_exec.git_succeeds(['rev-parse', '--is-inside-work-tree'], root)
}

// The line `josh init` ends with in a Git repository whose checkout does not hold kit yet: the setup is
// still uncommitted, and `josh start` is what carries it to GitHub.
function start_hint(root: string): string | undefined {
	if (!is_git_work_tree(root) || is_kit_committed(root)) return undefined

	return START_HINT
}

const kit_setup_state = { is_kit_committed, start_hint }

export { kit_setup_state }
