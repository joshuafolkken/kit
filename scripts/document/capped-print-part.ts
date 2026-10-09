import path from 'node:path'

// Where `capped-print.ts` writes the parts of an over-cap output, and how a path is recognized as one
// of them. Both halves live here so the writer and the investigation guard,
// which must not count a read of a part as reading the Issue's subject, share one spelling of the
// shape — kept free of the writer's own imports, since the guard runs as a hook on every tool call.

const DIRECTORY_PREFIX = 'josh-capped-print-'
const PART_PREFIX = 'part-'
const PART_SUFFIX = '.md'
// A part is `part-<N>.md` and nothing else, so a run's own file that happens to sit beside one is not
// mistaken for it.
const PART_PATTERN = /^part-[1-9]\d*\.md$/u

function part_name(index: number): string {
	return `${PART_PREFIX}${String(index + 1)}${PART_SUFFIX}`
}

// **The file's own parent, and the file's own name, both have to match.** A directory prefix alone
// would exempt anything a run unpacked under a similarly named directory; the caller also requires the
// path to lie outside the checkout, so no repository file is ever exempted by its name.
function is_part_file(absolute: string): boolean {
	const parent = path.basename(path.dirname(absolute))

	return parent.startsWith(DIRECTORY_PREFIX) && PART_PATTERN.test(path.basename(absolute))
}

const capped_print_part = { DIRECTORY_PREFIX, part_name, is_part_file }

export { capped_print_part }
