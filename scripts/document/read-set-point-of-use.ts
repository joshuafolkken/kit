// Which documents a workflow entry point names but reads only later — point-of-use, not entry read
// (joshuafolkken/kit#1776, split out of `entry-read-set.ts` in joshuafolkken/kit#2289 to keep that
// file under its line ceiling and to keep the point-of-use classification its own concern from the
// costing that reads it).
//
// **Four documents leave the entry read because their first use is a named command, not the entry**
// (joshuafolkken/kit#1797, joshuafolkken/kit#1856, joshuafolkken/kit#1873). `latest-gate.md` is read
// when `pnpm josh latest:scope` answers `required`, `followup.md` in the turn that issues
// `pnpm josh followup`, `chain-rule.md` before the first `pnpm josh gate` launch it governs
// (joshuafolkken/kit#2296 — the section is how that gate starts, overlapped with the review), and
// `background-commands.md` before the first backgroundable command (`pnpm josh gate`). **They are
// not deferred or summarized** — the named operational section is fetched in the same turn; only
// `latest-gate.md` remains whole because its result branches across that document.
// Measured on `fullrun #1783`, `followup.md` rode 55 requests before its first use. **`chain-rule.md`
// is joshuafolkken/kit#1856's addition**: it governs the `/code-review` → `followup` chain, which in
// `fullrun` / `queue` / `epicrun` / `backlogrun` runs *after* the first edit, so its 7,396 tokens
// were resident from the entry for no run that had yet reached a review.
// **`background-commands.md` is joshuafolkken/kit#1873's**: it was §2h's resident body, governing the
// background execution of the gate, the push and the merge tail — all after the first edit — so it
// left `SKILL.md` for the point-of-use list. `SKILL.md` → §1, "Four documents are read at the point
// of use", is the single source.
// **`backlogrun`'s own per-child phase documents are point-of-use too** (joshuafolkken/kit#2010):
// `backlogrun.md` was split so the entry read carries only what binds before the first child, and the
// four phase documents below are read from it at the step each names — dispatching a child, opening a
// lane, the progress watcher and the hand-off, a child that cannot finish — never at the entry. Kept
// out of the count here, exactly as the four above are. `SKILL.md` → §1 is the human source.
// **`backlogrun-steps.md` joins them** (joshuafolkken/kit#2190): `backlogrun.md` was cut to a manifest
// and its detailed procedure moved into `backlogrun-steps.md`, read on demand rather than at the
// entry. Counting the manifest's pointers into it would put that prose straight back into the entry
// figure under another name, which is exactly what this reduction removes.
// **`pre-gate-cut.md` joins them** (joshuafolkken/kit#2289): it is the single source of the pre-gate
// cut, a step every implementing run — and every dispatched lane child — reaches after the entry, so
// its read is a point-of-use read the count was silently omitting. Measured on the backlogrun of
// 2026-09-21, the lane children read it 21 times across 13 runs — the largest single document read,
// and the one the point-of-use list had no row for.
const POINT_OF_USE_FILES: ReadonlySet<string> = new Set([
	'latest-gate.md',
	'followup.md',
	'chain-rule.md',
	'background-commands.md',
	'pre-gate-cut.md',
	'backlogrun-child.md',
	'backlogrun-lanes.md',
	'backlogrun-progress.md',
	'backlogrun-park.md',
	'backlogrun-steps.md',
	// Read only when `run:step` prints `pnpm josh retrospective` at a run's stop position — the very
	// end of a run, never the entry (joshuafolkken/kit#2328). Kept out of every entry's read for the
	// same reason the phase documents above are: no run that never drains its backlog reaches it.
	'retrospective.md',
])

// **A file an entry names but reads only later — point-of-use for that entry, an entry read for
// another** (joshuafolkken/kit#2161). The global set above cannot express this, because a file
// dropped there leaves *every* entry's read. `backlogrun`'s parent orchestrates and never
// implements: a dispatched child reads `fullrun.md` and `split-assessment.md` inside its own
// delegated `fullrun` unit (`backlogrun-child.md`), so the parent pays for neither at its entry —
// while `fullrun`, `halfrun` and `kickoff` each read them at theirs. Keyed by entry keyword; an entry
// the map does not name drops nothing beyond the global set.
const POINT_OF_USE_BY_ENTRY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['backlogrun', new Set(['fullrun.md', 'split-assessment.md'])],
])

const NO_PER_ENTRY_FILES: ReadonlySet<string> = new Set()

// **A file is point-of-use for an entry when the global set names it, or the per-entry map does.**
function is_point_of_use(entry: string, file: string): boolean {
	if (POINT_OF_USE_FILES.has(file)) return true

	return (POINT_OF_USE_BY_ENTRY.get(entry) ?? NO_PER_ENTRY_FILES).has(file)
}

// The global point-of-use files plus the ones this entry names in its own row — for `backlogrun`,
// `fullrun.md` and `split-assessment.md`, so the report accounts for what the child reads later.
function point_of_use_files(entry: string): Array<string> {
	return [...POINT_OF_USE_FILES, ...(POINT_OF_USE_BY_ENTRY.get(entry) ?? NO_PER_ENTRY_FILES)]
}

const read_set_point_of_use = {
	POINT_OF_USE_FILES,
	POINT_OF_USE_BY_ENTRY,
	is_point_of_use,
	point_of_use_files,
}

export { read_set_point_of_use }
