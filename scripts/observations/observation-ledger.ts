// The observation ledger's one path, named here rather than inside any of the places that act on it
// (joshuafolkken/kit#1756). `git-staging.ts` excludes it from every ordinary commit,
// `hook-gate-reuse.ts` excludes it from what a hook calls a carried tree, and
// `observations-flush.ts` is the only thing that stages it — so a literal in each would be three
// answers to one question, and a rename reaching only some of them would silently restore the
// contamination the exclusion exists to prevent.
const OBSERVATION_LEDGER_PATH = 'docs/observations.md'

// `git status --porcelain` prints `XY PATH`, so the path starts at the fourth character.
const STATUS_PATH_INDEX = 3

function status_path(line: string): string {
	return line.slice(STATUS_PATH_INDEX).trim()
}

function is_ledger_line(line: string): boolean {
	return status_path(line) === OBSERVATION_LEDGER_PATH
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
	status_path,
}

export { OBSERVATION_LEDGER_PATH, observation_ledger }
