// The path lists a review brief prints.

// Absolute, for the same reason the round-1 target carries `-C`: git prints repository-root-relative
// paths, and a forked agent sitting in another checkout resolves them against that one — where the
// same relative path names a different file, or none.
function format_paths(root: string, paths: ReadonlyArray<string>): string {
	return paths.map((relative) => `  ${root}/${relative}`).join('\n')
}

// **A recorded High's fix is round 2's to verify, read whole** (joshuafolkken/kit#4941): `josh ship`
// reuses the lane's round 1 once only round 2's delta moved, so this pass is the one that reads the fix
// — and a fix can reach past the hunks the delta shows.
const HIGH_FIX_LINE =
	'These files hold the fix of a High round 1 recorded — read each whole, not only its hunks, with the fix sites the finding names:'

function high_fix_lines(root: string, cited: ReadonlyArray<string> = []): ReadonlyArray<string> {
	return cited.length === 0 ? [] : [`${HIGH_FIX_LINE}\n${format_paths(root, cited)}`]
}

const review_brief_paths = { format_paths, HIGH_FIX_LINE, high_fix_lines }

export { review_brief_paths }
