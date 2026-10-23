import { get_exit_code } from '#scripts/git/git-execa-error'
import { git_spawn } from '#scripts/git/git-spawn'

// One fixed-string `git grep -n` over a pathspec, read back as `file:line` hits with a short excerpt.
// `run:prep`'s code locations and `plan:consumers` both search a name this way, so the parse and the
// no-match-versus-failure reading live here rather than in each.

const GREP_LINE = /^(?<path>[^:]+):(?<line>\d+):(?<text>.*)$/u
const MAX_EXCERPT_LENGTH = 80
const ELLIPSIS = '…'
// `git grep` exits 1 for no match; any other exit is a search that never ran.
const GREP_NO_MATCH_EXIT = 1

interface Hit {
	path: string
	line: string
	excerpt: string
}

interface GrepResult {
	hits: ReadonlyArray<Hit>
	has_failed: boolean
}

function shorten(text: string): string {
	const trimmed = text.trim()

	if (trimmed.length <= MAX_EXCERPT_LENGTH) return trimmed

	return `${trimmed.slice(0, MAX_EXCERPT_LENGTH)}${ELLIPSIS}`
}

// `git grep -n` prints `path:line:text`; the text may itself hold colons, so only the first two split.
function to_hit(output_line: string): Hit | undefined {
	const groups = GREP_LINE.exec(output_line)?.groups

	if (groups === undefined) return undefined

	// All three groups are non-optional in `GREP_LINE`, so a match always carries each of them.
	const { path, line, text } = groups as Record<'line' | 'path' | 'text', string>

	return { path, line, excerpt: shorten(text) }
}

function parse(stdout: string): Array<Hit> {
	const hits = stdout.split('\n').map((line) => to_hit(line))

	return hits.filter((hit): hit is Hit => hit !== undefined)
}

// `git grep` exits 1 when nothing matches, which `git_spawn.read` raises. Only that is "no match": a
// git without `grep -m` (older than 2.38) exits 129, and naming every target absent then would send
// the reader away from code that is there. `root` searches that checkout rather than the working
// directory's.
async function search(
	target: string,
	flags: ReadonlyArray<string>,
	pathspecs: ReadonlyArray<string>,
	root?: string,
): Promise<GrepResult> {
	const location = root === undefined ? [] : ['-C', root]
	const grep_arguments = [
		...location,
		'grep',
		'-n',
		'-I',
		'-F',
		...flags,
		'-e',
		target,
		'--',
		...pathspecs,
	]

	try {
		return { hits: parse(await git_spawn.read(grep_arguments)), has_failed: false }
	} catch (error) {
		return { hits: [], has_failed: get_exit_code(error) !== GREP_NO_MATCH_EXIT }
	}
}

const git_grep_hits = { parse, search }

export type { GrepResult, Hit }
export { git_grep_hits }
