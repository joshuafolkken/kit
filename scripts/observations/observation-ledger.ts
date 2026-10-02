// The observation ledger's one location, named here rather than inside any of the places that act on
// it (joshuafolkken/kit#1756). `git-staging.ts` stages it with the run's own commit when its grammar
// holds (joshuafolkken/kit#2763), `hook-gate-reuse.ts` excludes it from what a hook calls a carried
// tree, and `observations-flush.ts` commits what no run carried — so a literal in each would be three
// answers to one question, and a rename reaching only some of them would silently split them.
//
// **It sits under `docs/maintainers/`, apart from the reader-facing documents** (joshuafolkken/kit#2724).
//
// **It is a directory of one file per issue, not one file** (joshuafolkken/kit#2919). One file every
// run appended to made two lanes' pull requests conflict at its tail, so lanes parked their lines in
// the primary checkout for a batch-end flush — and another run's stash took them from there, and the
// flush never saw them. A run now appends to `<issue>.md` in its own work tree and merges it with its
// own pull request: parallel lanes write different files, so nothing conflicts and nothing waits.
const OBSERVATION_LEDGER_DIRECTORY = 'docs/maintainers/observations'

const LEDGER_FILE_EXTENSION = '.md'

// What the single-file ledgers held is moved here (`observation-ledger-migrate.ts`), so no line is
// lost to the split.
const LEGACY_LEDGER_FILE = `legacy${LEDGER_FILE_EXTENSION}`

// Where the ledger lived as one file — `docs/observations.md` before joshuafolkken/kit#2724 and
// `docs/maintainers/observations.md` until joshuafolkken/kit#2919 — kept as migration sources rather
// than forgotten: a run still on the old code, a stash cut before the move and a consumer repository's
// existing ledger all write there, and `observation-ledger-migrate.ts` moves what it finds into the
// directory. Every place that recognizes the ledger recognizes them, so a line on either path is never
// staged into an ordinary commit. Remove them once every repository holding a ledger has migrated.
const LEGACY_OBSERVATION_LEDGER_PATHS: ReadonlyArray<string> = [
	'docs/maintainers/observations.md',
	'docs/observations.md',
]

// `git status --porcelain` prints `XY PATH`, so the path starts at the fourth character.
const STATUS_PATH_INDEX = 3

function status_path(line: string): string {
	return line.slice(STATUS_PATH_INDEX).trim()
}

// The ledger file one writer appends to — an issue number, or a date for a line written outside any
// issue's run (`observation-ledger-home.ts` decides which).
function ledger_file(name: number | string): string {
	return `${OBSERVATION_LEDGER_DIRECTORY}/${String(name)}${LEDGER_FILE_EXTENSION}`
}

function is_ledger_file_name(name: string): boolean {
	return name.endsWith(LEDGER_FILE_EXTENSION)
}

// The suffix of the file a migration renames an old ledger to while it copies it
// (`observation-ledger-migrate.ts`): `docs/observations.md.<pid>.migrating`.
const MIGRATION_CLAIM_SUFFIX = '.migrating'

// A claim left by a process killed mid-migration holds ledger lines, so it is the ledger too: never
// staged by an ordinary commit, and absorbed by the next migration.
function is_migration_claim(file_path: string): boolean {
	return LEGACY_OBSERVATION_LEDGER_PATHS.some(
		(legacy) => file_path.startsWith(`${legacy}.`) && file_path.endsWith(MIGRATION_CLAIM_SUFFIX),
	)
}

// Porcelain status collapses an untracked directory to `docs/maintainers/observations/`, so the
// directory itself, trailing slash and all, is the ledger as much as any file inside it.
function is_in_directory(file_path: string): boolean {
	return file_path.startsWith(`${OBSERVATION_LEDGER_DIRECTORY}/`)
}

function is_ledger_path(file_path: string): boolean {
	return (
		is_in_directory(file_path) ||
		LEGACY_OBSERVATION_LEDGER_PATHS.includes(file_path) ||
		is_migration_claim(file_path)
	)
}

function is_ledger_line(line: string): boolean {
	return is_ledger_path(status_path(line))
}

// The ledger paths a porcelain status names — what a commit of the ledger stages, which may be a new
// file together with an old one's deletion.
function ledger_paths(status_output: string): ReadonlyArray<string> {
	return status_output
		.split('\n')
		.filter((line) => is_ledger_line(line))
		.map((line) => status_path(line))
}

// **The one place that answers "does this working tree hold a pending observation append?"**
// `observations-flush.ts`'s `has_ledger_change` and `pnpm josh followup`'s pre-merge ledger commit
// both ask it (joshuafolkken/kit#1810), so a literal in each would be the clone the header above
// warns against. A blank porcelain line carries no ledger path, so `is_ledger_line` answers false for
// it and no filtering is needed.
function has_pending_append(status_output: string): boolean {
	return status_output.split('\n').some((line) => is_ledger_line(line))
}

const observation_ledger = {
	has_pending_append,
	is_ledger_file_name,
	is_ledger_line,
	is_ledger_path,
	is_migration_claim,
	ledger_file,
	ledger_paths,
	status_path,
}

export {
	LEDGER_FILE_EXTENSION,
	LEGACY_LEDGER_FILE,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	MIGRATION_CLAIM_SUFFIX,
	OBSERVATION_LEDGER_DIRECTORY,
	observation_ledger,
}
