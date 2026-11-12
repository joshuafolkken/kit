import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { overrides_files } from './overrides-files'
import { overrides_check, type OverridesDiff, type OverridesSources } from './overrides-logic'

// The two ends `josh overrides --diff` compares, read from git rather than a snapshot, so the check
// needs no `--save` before the update ran. `<base>` is an update not yet committed: the revision
// against the working tree. `<base>...<head>` is `josh adopt`, which commits on its branch and
// returns to the default one: the branch tip against its merge-base with `<base>`.
const RANGE_SEPARATOR = '...'
// A tag or tree name resolves too; only a commit has the two files to read.
const COMMIT_PEEL = '^{commit}'

interface DiffSources {
	before: OverridesSources
	after: OverridesSources
}

function resolve_commit(revision: string): string | undefined {
	return git_spawn_sync.read(['rev-parse', '--verify', '--quiet', `${revision}${COMMIT_PEEL}`])
}

// A file absent at a commit reads as empty, the way `overrides_files` reads one absent on disk; the
// commit itself was resolved first, so a failed `git show` here is never a mistyped revision.
function read_at(commit: string, path: string): string {
	return git_spawn_sync.read(['show', `${commit}:./${path}`]) ?? ''
}

function read_sources_at(commit: string): OverridesSources {
	return {
		package_json: read_at(commit, PACKAGE_JSON),
		workspace_yaml: read_at(commit, overrides_check.WORKSPACE_YAML_PATH),
	}
}

function read_against_worktree(base: string): DiffSources | undefined {
	const before = resolve_commit(base)
	if (before === undefined) return undefined

	return { before: read_sources_at(before), after: overrides_files.read_current_sources() }
}

// Both ends are resolved first, so an option-shaped name such as `--octopus` never reaches
// `merge-base` as a flag.
function read_against_branch(base: string, head: string): DiffSources | undefined {
	const base_commit = resolve_commit(base)
	const after = resolve_commit(head)
	if (base_commit === undefined || after === undefined) return undefined
	const before = git_spawn_sync.read(['merge-base', base_commit, after])
	if (before === undefined) return undefined

	return { before: read_sources_at(before), after: read_sources_at(after) }
}

// `undefined` when either end does not resolve to a commit — a mistyped base, an empty side of
// `...`, or two histories with no merge-base.
function read_sources(range: string): DiffSources | undefined {
	const separator = range.indexOf(RANGE_SEPARATOR)
	if (separator === -1) return read_against_worktree(range)

	return read_against_branch(
		range.slice(0, separator),
		range.slice(separator + RANGE_SEPARATOR.length),
	)
}

interface ChangedBlock {
	file: string
	diff: OverridesDiff
}

// pnpm applies only the workspace block, but an update has to leave the ignored `package.json` one as
// it found it too, so a change to either is reported under the file it was made in.
function changed_blocks(sources: DiffSources): Array<ChangedBlock> {
	const { before, after } = sources
	const blocks = [
		{
			file: overrides_check.WORKSPACE_YAML_PATH,
			diff: overrides_check.compare(
				overrides_check.read_overrides(before),
				overrides_check.read_overrides(after),
			),
		},
		{
			file: PACKAGE_JSON,
			diff: overrides_check.compare(
				overrides_check.read_overrides_from_package(before.package_json),
				overrides_check.read_overrides_from_package(after.package_json),
			),
		},
	]

	return blocks.filter((block) => block.diff.is_changed)
}

const overrides_diff = { read_sources, changed_blocks }

export { overrides_diff, type DiffSources, type ChangedBlock }
