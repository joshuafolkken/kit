// The observation ledger's one location, named here rather than inside any of the places that act on
// it. `git-staging.ts` stages it with the run's own commit when its grammar
// holds, `hook-gate-reuse.ts` excludes it from what a hook calls a carried
// tree, and `observations-flush.ts` commits what no run carried — so a literal in each would be three
// answers to one question, and a rename reaching only some of them would silently split them.
//
// **It sits outside `docs/`**: its files are machine-written data lines, not
// documents a person reads, and at about forty new files a day they would be most of `docs/`.
//
// **It is a directory of one file per issue, not one file**. One file every run appends to makes two
// lanes' pull requests conflict at its tail, and parking the lines in the primary checkout for a
// batch-end flush lets another run's stash take them before the flush sees them. A run appends to
// `<issue>.md` in its own work tree and merges it with its own pull request: parallel lanes write
// different files, so nothing conflicts and nothing waits.
const OBSERVATION_LEDGER_DIRECTORY = '.josh/observations'

const LEDGER_FILE_EXTENSION = '.md'

// The suffix of a closed issue's carried comment rounds, `<issue>-comment-rounds.md` — named here
// because both the carry that writes it and the archive that moves it read it.
const CARRIED_ROUNDS_SUFFIX = '-comment-rounds'

// The single-file ledger paths, `docs/observations.md` and `docs/maintainers/observations.md`, from
// before the ledger became a directory. Nothing reads or migrates them any more; a run still on an old
// kit may write there, so `observation-ledger-legacy.ts` warns when one exists and every place that
// recognizes the ledger recognizes them, keeping such a line out of an ordinary commit.
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

// Porcelain status collapses an untracked directory to `.josh/observations/`, so the directory
// itself, trailing slash and all, is the ledger as much as any file inside it.
function is_in_directory(file_path: string): boolean {
	return file_path.startsWith(`${OBSERVATION_LEDGER_DIRECTORY}/`)
}

function is_ledger_path(file_path: string): boolean {
	return is_in_directory(file_path) || LEGACY_OBSERVATION_LEDGER_PATHS.includes(file_path)
}

// The git pathspec of every path but the ledger — the same paths `is_ledger_path` answers, for a git
// command to leave out. `:/` and `top` anchor it at the repository root, so a command run from a
// subdirectory still covers the whole tree and still leaves the root's ledger alone.
const LEDGER_EXCLUSION_PATHSPEC: ReadonlyArray<string> = [
	':/',
	`:(top,exclude)${OBSERVATION_LEDGER_DIRECTORY}`,
	...LEGACY_OBSERVATION_LEDGER_PATHS.map((legacy) => `:(top,exclude)${legacy}`),
]

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
// both ask it, so a literal in each would be the clone the header above
// warns against. A blank porcelain line carries no ledger path, so `is_ledger_line` answers false for
// it and no filtering is needed.
function has_pending_append(status_output: string): boolean {
	return status_output.split('\n').some((line) => is_ledger_line(line))
}

// The changed paths a porcelain status names outside the ledger — the work a checkout or a flush must not
// carry off, since only the ledger's appended lines are expected to ride along.
function other_paths(status_output: string): ReadonlyArray<string> {
	return status_output
		.split('\n')
		.filter((line) => line.trim().length > 0 && !is_ledger_line(line))
		.map((line) => status_path(line))
}

const observation_ledger = {
	has_pending_append,
	is_ledger_file_name,
	is_ledger_line,
	is_ledger_path,
	ledger_file,
	ledger_paths,
	other_paths,
	status_path,
}

export {
	CARRIED_ROUNDS_SUFFIX,
	LEDGER_EXCLUSION_PATHSPEC,
	LEDGER_FILE_EXTENSION,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	OBSERVATION_LEDGER_DIRECTORY,
	observation_ledger,
}
