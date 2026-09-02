import { readFileSync } from 'node:fs'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { stamp_file } from '#scripts/josh/stamp-file'

// The tree `josh review:brief` records: every path the change touches, and the digest of its content
// (joshuafolkken/kit#1241).
//
// The path list is `#scripts/git/changed-paths`', the same reading `josh review:level` and
// `josh eval:scope` decide from — a second definition of "changed" would let the brief describe a
// different change from the level printed beside it.
//
// **The digests are what a `git diff` cannot give.** The implementation and a review's fixes are
// uncommitted in the same tree, so a diff cannot say which side of the review a change fell on; a
// digest taken before round 1 and compared after the fixes names exactly the fix delta.

// A path the change lists but the working tree does not hold — deleted, or renamed away. Recorded
// rather than dropped: a delete applied by a fix is part of the fix delta, and a dropped entry would
// read as "unchanged" on the comparison.
const ABSENT_DIGEST = 'absent'

function digest_of(root: string, relative: string): string {
	try {
		return stamp_file.digest(readFileSync(path.join(root, relative)))
	} catch {
		return ABSENT_DIGEST
	}
}

// Sorted so two readings of one tree produce the same record byte for byte, which is what lets a
// stored stamp be compared against a fresh reading without a normalization step in between.
function tree_of(root: string, paths: ReadonlyArray<string>): Record<string, string> {
	const sorted = [...paths].toSorted((left, right) => left.localeCompare(right))

	return Object.fromEntries(sorted.map((relative) => [relative, digest_of(root, relative)]))
}

// **The root is asked of git, never taken from `process.cwd()` — nor from `PROJECT_ROOT`, which is
// defined as `process.cwd()`.** git prints repository-root-relative paths, so joining them onto the
// working directory resolves to nothing whenever a command runs from a subdirectory: every digest
// becomes `absent` on both sides of a comparison, and two such maps *agree*. The brief would then
// say the gate had verified an arbitrarily edited tree, and `--round 2` would report an empty fix
// delta. **A defect that answers "all clear" is the one shape this record cannot take**, which is why
// the root is resolved rather than assumed (measured from `scripts/`: 18 of 25 entries `absent`).
async function read_changed_tree(
	paths?: ReadonlyArray<string>,
	root?: string,
): Promise<Record<string, string>> {
	return tree_of(
		root ?? (await git_command.repository_root()),
		paths ?? (await changed_paths.read_changed_paths(false)),
	)
}

const review_tree = { ABSENT_DIGEST, digest_of, read_changed_tree, tree_of }

export { review_tree }
