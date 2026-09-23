import { git_spawn } from './git-spawn'

// What `josh main:merge` refuses before it merges, and what it tells the run to do instead
// (joshuafolkken/kit#2445).
//
// **A dirty tree is not refused as such.** The chain runs `main:merge` before the commit, over the
// uncommitted implementation, and git carries uncommitted changes through a merge that touches none of
// them. What goes wrong is the two states git itself cannot merge over — a path both sides changed, and
// an index still holding unresolved paths. Git's own refusal there names no way forward, and the way a
// lane child found was a stash round trip around the merge, whose reapply left `UU` in the index and a
// run asking a person for `git add`. The refusal here is the same condition with the sanctioned way out.

// `XY <path>` — two status letters and a space before the path.
const STATUS_CODE_LENGTH = 2
const STATUS_PREFIX_LENGTH = STATUS_CODE_LENGTH + 1
const RENAME_SEPARATOR = ' -> '
const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
// The index column of a line whose path has nothing staged — unchanged, untracked, or ignored.
const UNSTAGED_INDEX_CODES = new Set([' ', '?', '!'])
const DIRECTORY_SUFFIX = '/'
const COMMIT_COMMAND = '`pnpm josh git -y`'
const PROCEDURE_POINTER =
	'`.claude/skills/workflow-commands/chain-rule.md` → "origin/main is merged in before the gate"'

function status_lines(status: string): Array<string> {
	return status.split('\n').filter((line) => line.length > STATUS_PREFIX_LENGTH)
}

// A rename line names both sides; either one is a path the merge could collide with.
function line_paths(line: string): Array<string> {
	return line.slice(STATUS_PREFIX_LENGTH).split(RENAME_SEPARATOR)
}

function unmerged_paths(status: string): Array<string> {
	return status_lines(status)
		.filter((line) => UNMERGED_CODES.has(line.slice(0, STATUS_CODE_LENGTH)))
		.flatMap((line) => line_paths(line))
}

// Git's ort strategy refuses a merge whenever the index differs from HEAD, whatever paths the staged
// changes touch — a stash reapply that conflicted leaves its merged half staged in exactly this way.
function staged_paths(status: string): Array<string> {
	return status_lines(status)
		.filter((line) => !UNSTAGED_INDEX_CODES.has(line.charAt(0)))
		.flatMap((line) => line_paths(line))
}

// An untracked directory is reported as `dir/`, so it covers every incoming path beneath it.
function covers(uncommitted: string, incoming: string): boolean {
	if (uncommitted.endsWith(DIRECTORY_SUFFIX)) return incoming.startsWith(uncommitted)

	return uncommitted === incoming
}

function overlapping_paths(status: string, incoming: ReadonlyArray<string>): Array<string> {
	const uncommitted = status_lines(status).flatMap((line) => line_paths(line))

	return uncommitted.filter((path) => incoming.some((changed) => covers(path, changed)))
}

function unmerged_message(paths: ReadonlyArray<string>): string {
	return (
		`main:merge: the index still holds unresolved paths (${paths.join(', ')}). Remove the conflict ` +
		`markers, then finish through ${COMMIT_COMMAND} — it stages and commits them, so no \`git add\` ` +
		`permission is needed, and inside a lane this is Tier A. Rerun \`pnpm josh main:merge\` after it ` +
		`(${PROCEDURE_POINTER}).`
	)
}

function staged_message(paths: ReadonlyArray<string>): string {
	return (
		`main:merge: the index holds staged changes (${paths.join(', ')}), which git refuses to merge ` +
		`over. Commit them first through ${COMMIT_COMMAND}, then rerun \`pnpm josh main:merge\` ` +
		`(${PROCEDURE_POINTER}).`
	)
}

function overlap_message(default_branch: string, paths: ReadonlyArray<string>): string {
	return (
		`main:merge: uncommitted changes touch files origin/${default_branch} also changed ` +
		`(${paths.join(', ')}). Commit the work first through ${COMMIT_COMMAND}, then rerun ` +
		`\`pnpm josh main:merge\`. Never stash around the merge — a stash reapplied over it leaves the ` +
		`conflict half-recorded in the index (${PROCEDURE_POINTER}).`
	)
}

// Appended to git's own report when the merge itself stops on a conflict.
const CONFLICT_HINT =
	`main:merge: finish a conflicted merge by removing the conflict markers, then ${COMMIT_COMMAND} ` +
	`records the merge commit — no \`git add\` permission is needed (${PROCEDURE_POINTER}).`

function refusal(
	status: string,
	incoming: ReadonlyArray<string>,
	default_branch: string,
): string | undefined {
	const unmerged = unmerged_paths(status)

	if (unmerged.length > 0) return unmerged_message(unmerged)
	// Nothing incoming means git answers "Already up to date" whatever the index holds.
	if (incoming.length === 0) return undefined

	const staged = staged_paths(status)

	if (staged.length > 0) return staged_message(staged)

	const overlap = overlapping_paths(status, incoming)

	return overlap.length > 0 ? overlap_message(default_branch, overlap) : undefined
}

// The paths the default branch changed since this branch left it — what the merge would bring in.
// `--no-renames` lists both sides of a rename, so an edit to the old name still counts as an overlap.
async function incoming_paths(default_branch: string): Promise<Array<string>> {
	const output = await git_spawn.read([
		'diff',
		'--name-only',
		'--no-renames',
		`HEAD...origin/${default_branch}`,
	])

	return output.split('\n').filter((line) => line !== '')
}

const main_merge_guard = {
	CONFLICT_HINT,
	incoming_paths,
	overlapping_paths,
	refusal,
	staged_paths,
	unmerged_paths,
}

export { main_merge_guard }
