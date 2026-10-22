import { git_spawn } from '#scripts/git/git-spawn'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import type { GateTree } from './gate-tree'

// Every path whose content can differ from the tree a green record was taken on — the one reading the
// gate's per-check reuse (`check-reuse.ts`) and the scoped checks' since-green narrowing
// (`since-green.ts`) both act on, so the two can never disagree about what moved.
//
// **What moved is the union of two diffs**. The changed-file map is a diff against the merge base, so a
// path absent from both maps holds the merge base's content — and the base's own diff
// (`git diff <recorded> <current>`) names every path that content moved for, which is what a main sync
// brought in. A path in either map whose digest differs is the other half
// (`file_map_stamp.changed_since`).

const NAME_SEPARATOR = '\0'
const BASE_DIFF = ['diff', '--name-only', '--no-renames', '-z'] as const

async function base_diff(from: string, to: string): Promise<ReadonlyArray<string> | undefined> {
	if (from === to) return []

	try {
		const names = await git_spawn.read([...BASE_DIFF, from, to])

		return names.split(NAME_SEPARATOR).filter((name) => name !== '')
	} catch {
		return undefined
	}
}

// The two diffs apart: `synced` is what a main sync brought in, `changed` the paths whose digest moved.
// A path can be in both.
interface MovedParts {
	changed: ReadonlyArray<string>
	synced: ReadonlyArray<string>
}

// `undefined` when the record cannot be compared: no base on either side, or a tree map that came back
// empty — also what `gate-tree.ts` answers when git could not be read, so it describes no tree.
async function moved_parts(stamp: FileMapStamp, tree: GateTree): Promise<MovedParts | undefined> {
	const is_unread = Object.keys(tree.files).length === 0

	if (is_unread || stamp.base === undefined || tree.base === undefined) return undefined

	const synced = await base_diff(stamp.base, tree.base)

	if (synced === undefined) return undefined

	return { changed: file_map_stamp.changed_since(stamp, tree.files), synced }
}

function union_of(parts: MovedParts): ReadonlyArray<string> {
	return [...new Set([...parts.changed, ...parts.synced])]
}

async function moved_since(
	stamp: FileMapStamp,
	tree: GateTree,
): Promise<ReadonlyArray<string> | undefined> {
	const parts = await moved_parts(stamp, tree)

	return parts === undefined ? undefined : union_of(parts)
}

const moved_paths = { moved_parts, moved_since, union_of }

export type { MovedParts }
export { moved_paths }
