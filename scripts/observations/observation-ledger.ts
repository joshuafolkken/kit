// The observation ledger's one path, named here rather than inside any of the places that act on it
// (joshuafolkken/kit#1756). `git-staging.ts` excludes it from every ordinary commit,
// `hook-gate-reuse.ts` excludes it from what a hook calls a carried tree, and
// `observations-flush.ts` is the only thing that stages it — so a literal in each would be three
// answers to one question, and a rename reaching only some of them would silently restore the
// contamination the exclusion exists to prevent.
//
// **It sits under `docs/maintainers/`, apart from the reader-facing documents** (joshuafolkken/kit#2724).
const OBSERVATION_LEDGER_PATH = 'docs/maintainers/observations.md'

// Where the ledger lived before joshuafolkken/kit#2724, kept as a migration source rather than
// forgotten: a run still on the old code, a stash cut before the move and a consumer repository's
// existing ledger all write here, and `observation-ledger-migrate.ts` moves what it finds to the path
// above. Every place that recognizes the ledger recognizes both, so a line on either path is never
// staged into an ordinary commit. Remove it once every repository holding a ledger has migrated.
const LEGACY_OBSERVATION_LEDGER_PATH = 'docs/observations.md'

const OBSERVATION_LEDGER_PATHS: ReadonlyArray<string> = [
	OBSERVATION_LEDGER_PATH,
	LEGACY_OBSERVATION_LEDGER_PATH,
]

// `git status --porcelain` prints `XY PATH`, so the path starts at the fourth character.
const STATUS_PATH_INDEX = 3

function status_path(line: string): string {
	return line.slice(STATUS_PATH_INDEX).trim()
}

// The suffix of the file a migration renames the old ledger to while it copies it
// (`observation-ledger-migrate.ts`): `docs/observations.md.<pid>.migrating`.
const MIGRATION_CLAIM_SUFFIX = '.migrating'

// A claim left by a process killed mid-migration holds ledger lines, so it is the ledger too: never
// staged by an ordinary commit, and absorbed by the next migration.
function is_migration_claim(file_path: string): boolean {
	return (
		file_path.startsWith(`${LEGACY_OBSERVATION_LEDGER_PATH}.`) &&
		file_path.endsWith(MIGRATION_CLAIM_SUFFIX)
	)
}

function is_ledger_path(file_path: string): boolean {
	return OBSERVATION_LEDGER_PATHS.includes(file_path) || is_migration_claim(file_path)
}

function is_ledger_line(line: string): boolean {
	return is_ledger_path(status_path(line))
}

// The ledger paths a porcelain status names — what a flush stages after a migration, which may be the
// new file together with the old one's deletion.
function ledger_paths(status_output: string): ReadonlyArray<string> {
	return status_output
		.split('\n')
		.filter((line) => is_ledger_line(line))
		.map((line) => status_path(line))
}

// **The one place that answers "does this working tree hold a pending observation append?"**
// `observations-flush.ts`'s `has_ledger_change` and `pnpm josh followup`'s pre-flush short-circuit
// both ask it (joshuafolkken/kit#1810), so a literal in each would be the clone the header above
// warns against. A blank porcelain line carries no ledger path, so `is_ledger_line` answers false for
// it and no filtering is needed.
function has_pending_append(status_output: string): boolean {
	return status_output.split('\n').some((line) => is_ledger_line(line))
}

const observation_ledger = {
	has_pending_append,
	is_ledger_line,
	is_ledger_path,
	ledger_paths,
	status_path,
}

export {
	LEGACY_OBSERVATION_LEDGER_PATH,
	MIGRATION_CLAIM_SUFFIX,
	OBSERVATION_LEDGER_PATH,
	OBSERVATION_LEDGER_PATHS,
	observation_ledger,
}
