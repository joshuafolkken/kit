import { git_grep_hits, type Hit } from '#scripts/git/git-grep-hits'
import { git_spawn } from '#scripts/git/git-spawn'

// The code locations an issue names, bundled into `run:prep`. Investigation is most of a run's
// round trips, and most of it opens the files an issue names one read at a time. This finds each
// path, identifier and command the body puts in backticks and hands back where it occurs in code —
// `file:line` and a short excerpt, never a whole file — so the first read lands on the right place.
//
// **Only a backticked span is a target.** A prose word is not a name, and a span holding a space is a
// command line or a sentence rather than one thing to look up; the one exception is a `josh` command,
// whose subcommand is the name.

const BACKTICKED = /`([^`\n]+)`/gu
const JOSH_PREFIX = /^(?:pnpm\s+)?josh\s+(\S+)/u
// A `file:line` citation names the file; the suffix would make both the file lookup and the grep miss.
const LINE_SUFFIX = /(?::\d+)+$/u
// A name carries a separator a prose word does not — `run:prep`, `run_prep`, `run-prep.ts`, `a/b`.
const NAME_CHARACTERS = /^[\w@./:-]+$/u
const NAME_SEPARATOR = /[./:_-]/u
const MIN_TARGET_LENGTH = 3
const MAX_TARGETS = 10
const MAX_FILES_PER_TARGET = 3
const INDENT = '  '
const HIT_SEPARATOR = '  '
const NO_MATCH = ' — no match in code'
const SEARCH_FAILED = ' — git grep failed; not searched'
const FILE_PATHSPEC = ':(glob)**/'
const FILE_HIT = { line: '1', excerpt: '(file named in the issue)' }
const NO_TARGETS = '(no backticked path or identifier in the issue)'
// Code only, tests and snapshots excluded: a document mentions a name far more often than code
// defines it, and the three-file cap would fill with prose before reaching the implementation.
const CODE_PATHS = [
	'*.ts',
	'*.js',
	'*.svelte',
	':(exclude)*.test.ts',
	':(exclude)*.e2e.ts',
	':(exclude)*.snap',
]

interface Located {
	target: string
	hits: ReadonlyArray<Hit>
	has_failed: boolean
}

function to_target(span: string): string {
	const josh = JOSH_PREFIX.exec(span)

	return josh?.[1] ?? span.trim().replace(LINE_SUFFIX, '')
}

function is_name(target: string): boolean {
	if (target.length < MIN_TARGET_LENGTH || target.includes('://')) return false

	return NAME_CHARACTERS.test(target) && NAME_SEPARATOR.test(target)
}

function extract_targets(text: string): Array<string> {
	const targets = [...text.matchAll(BACKTICKED)].map((match) => to_target(match[1] ?? ''))

	return [...new Set(targets.filter((target) => is_name(target)))].slice(0, MAX_TARGETS)
}

function format_target(located: Located): string {
	if (located.has_failed) return `${located.target}${SEARCH_FAILED}`
	if (located.hits.length === 0) return `${located.target}${NO_MATCH}`

	const lines = located.hits.map(
		(hit) => `${INDENT}${hit.path}:${hit.line}${HIT_SEPARATOR}${hit.excerpt}`,
	)

	return [located.target, ...lines].join('\n')
}

function format_locations(located: ReadonlyArray<Located>): string {
	if (located.length === 0) return NO_TARGETS

	return located.map((entry) => format_target(entry)).join('\n')
}

// Neither a no-match nor a search that could not run fails the bundle — the issue body is still worth
// printing without it — but only the first is reported as "no match" (`git-grep-hits.ts`).
async function grep(target: string): Promise<Located> {
	const { hits, has_failed } = await git_grep_hits.search(target, ['-m', '1'], CODE_PATHS)

	return { target, hits: hits.slice(0, MAX_FILES_PER_TARGET), has_failed }
}

// A path is rarely spelled out inside code — imports drop the extension and resolve relatively — so
// grepping `scripts/run/run-prep.ts` misses the very file an issue most often names. A tracked file
// whose path ends in the target is the location itself; `**/` lets a bare file name match too.
async function find_files(target: string): Promise<Array<Hit>> {
	try {
		const stdout = await git_spawn.read(['ls-files', '--', `${FILE_PATHSPEC}${target}`])
		const paths = stdout.split('\n').filter((path) => path !== '')

		return paths.slice(0, MAX_FILES_PER_TARGET).map((path) => ({ path, ...FILE_HIT }))
	} catch {
		return []
	}
}

async function find(target: string): Promise<Located> {
	const files = await find_files(target)

	if (files.length > 0) return { target, hits: files, has_failed: false }

	return await grep(target)
}

async function locate(text: string): Promise<string> {
	const located = await Promise.all(extract_targets(text).map(async (target) => await find(target)))

	return format_locations(located)
}

const run_prep_locate = { extract_targets, locate }

export type { Located }
export { run_prep_locate }
