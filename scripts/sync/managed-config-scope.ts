import { init_logic } from '#scripts/init/init-logic'
import { synced_paths } from './synced-paths'

// The three lists `josh sync` distributes from, spelled exactly as they are declared in
// `scripts/init/init-logic.ts`. The answer has to name which list claimed a path, and a paraphrase
// would send the reader looking for a constant that does not exist.
const AI_COPY_FILES_LIST = 'AI_COPY_FILES'
const AI_COPY_FILE_MAPPINGS_LIST = 'AI_COPY_FILE_MAPPINGS'
const AI_COPY_DIRECTORIES_LIST = 'AI_COPY_DIRECTORIES'

// The fourth source, named for the module that enumerates it rather than for an array in
// `init-logic.ts`: these destinations are written by `sync.ts` directly and appear on no list there.
const SYNCED_PATHS_LIST = 'SYNCED_PATHS'

const PATH_SEPARATOR = '/'

interface ManagedHit {
	path: string
	list: string
}

// A directory entry carries no trailing separator, so a bare `startsWith` would also claim a sibling
// whose name merely begins with it — `.claude/skills/workflow-commands-x/a.md` against
// `.claude/skills/workflow-commands`. Appending the separator is what makes this a containment test
// rather than a prefix test.
function is_inside(path: string, directory: string): boolean {
	return path === directory || path.startsWith(`${directory}${PATH_SEPARATOR}`)
}

function matches_file(path: string): boolean {
	return init_logic.get_ai_copy_files().includes(path)
}

// **Both ends of a mapping count.** `src` is this repository's own template path and `dest` is where
// the consumer receives the same file, so a change made here is caught by `src` and one read against
// a consumer checkout is caught by `dest`. Matching only one end would leave the other silent, which
// is the failure this whole module exists to remove.
function matches_mapping(path: string): boolean {
	return init_logic
		.get_ai_copy_file_mappings()
		.some((mapping) => mapping.src === path || mapping.dest === path)
}

function matches_directory(path: string): boolean {
	return init_logic.get_ai_copy_directories().some((directory) => is_inside(path, directory))
}

// The paths `josh sync` writes outside the three `AI_COPY_*` lists — `playwright.config.ts` and the
// rest. Reading only those three made the gate **narrower than the instruction it replaced**, whose
// own worked example was a file none of them holds (joshuafolkken/kit#1578).
function matches_synced_path(path: string): boolean {
	return synced_paths.get_synced_paths().includes(path)
}

// A table rather than a chain of `if`s: a fifth distribution surface is then one row, and the search
// order stays visible in one place. The sources are searched top to bottom and the first to claim the
// path wins — a path on two is reported once, because naming the second changes nothing the reader
// does and a second row per path would make the count of hits disagree with the count of files.
const MATCHERS: ReadonlyArray<{ list: string; matches: (path: string) => boolean }> = [
	{ list: AI_COPY_FILES_LIST, matches: matches_file },
	{ list: AI_COPY_FILE_MAPPINGS_LIST, matches: matches_mapping },
	{ list: AI_COPY_DIRECTORIES_LIST, matches: matches_directory },
	{ list: SYNCED_PATHS_LIST, matches: matches_synced_path },
]

function find_list(path: string): string | undefined {
	return MATCHERS.find((matcher) => matcher.matches(path))?.list
}

function to_hit(path: string): ManagedHit | undefined {
	const list = find_list(path)

	return list === undefined ? undefined : { path, list }
}

// One hit per path, in the order the paths arrived, so the output reads in the same order as the
// diff that produced it.
function find_managed_paths(paths: ReadonlyArray<string>): Array<ManagedHit> {
	return paths.flatMap((path) => to_hit(path) ?? [])
}

function has_managed_path(paths: ReadonlyArray<string>): boolean {
	return paths.some((path) => find_list(path) !== undefined)
}

// The path *and* the list that claimed it, because the two answer different questions: which file to
// look at, and why it counts as distributed. `AI_COPY_DIRECTORIES` is the one a reader cannot derive
// by eye — the path matched a directory entry it does not textually equal (joshuafolkken/kit#1578).
function format_hit(hit: ManagedHit): string {
	return `${hit.path} (${hit.list})`
}

function format_hits(hits: ReadonlyArray<ManagedHit>): string {
	return hits.map((hit) => format_hit(hit)).join('\n')
}

const managed_config_scope = {
	find_managed_paths,
	has_managed_path,
	format_hit,
	format_hits,
}

export {
	managed_config_scope,
	AI_COPY_FILES_LIST,
	AI_COPY_FILE_MAPPINGS_LIST,
	AI_COPY_DIRECTORIES_LIST,
	SYNCED_PATHS_LIST,
}
export type { ManagedHit }
