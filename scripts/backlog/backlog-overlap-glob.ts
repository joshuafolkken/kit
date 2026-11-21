import { path_glob } from '#scripts/gate/path-glob'

// joshuafolkken/kit#8529: a glob a body declares stays a pattern rather than widening to its directory.
// `scripts/run/board/run-board-cli*.test.ts` had read as `scripts/run/board/`, so it waited behind a
// lane that named only `scripts/run/board/run-board-reveal-rain.ts` and two lanes of six ran. A pattern is matched
// against the other path instead of expanded to tracked files, so a glob for files not yet written
// still meets the file another lane names.
const GLOB = '*'
const SEPARATOR = '/'

function is_glob(path: string): boolean {
	return path.includes(GLOB)
}

// A claim naming more than one file: a directory (`scripts/run/`) or a glob.
function is_area(path: string): boolean {
	return is_glob(path) || path.endsWith(SEPARATOR)
}

// The directory a claim's fixed part sits in — `scripts/lines/` for `scripts/lines/*.ts`; a directory
// is itself. Its depth decides whether the claim is narrow enough to count.
function directory_of(path: string): string {
	const glob = path.indexOf(GLOB)

	return path.slice(0, path.lastIndexOf(SEPARATOR, glob === -1 ? path.length : glob) + 1)
}

// The text every path an area covers starts with — a glob up to its first `*`, a directory itself.
function prefix_of(area: string): string {
	const glob = area.indexOf(GLOB)

	return glob === -1 ? area : area.slice(0, glob)
}

// Whether `glob` and `other` can name one path. A file is matched against the pattern. A directory or
// another glob meets it when either's fixed prefix starts the other's: a path both cover starts with
// both, so no overlap is missed, and a pair the rest of the patterns would keep apart still counts —
// the safe side.
function meets(glob: string, other: string): boolean {
	if (!is_area(other)) return path_glob.matches(other, glob)
	const left = prefix_of(glob)
	const right = prefix_of(other)

	return left.startsWith(right) || right.startsWith(left)
}

const backlog_overlap_glob = { directory_of, is_area, is_glob, meets }

export { backlog_overlap_glob }
