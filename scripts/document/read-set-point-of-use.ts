// Which documents a workflow entry point names but reads only later — point-of-use, not entry read.
// Kept apart from `entry-read-set.ts` so the point-of-use classification is its own concern from the
// costing that reads it.
//
// **Four documents leave the entry read because their first use is a named command, not the entry**.
// `latest-gate.md` is read
// when `pnpm josh latest:scope` answers `required`, `followup.md` in the turn that issues
// `pnpm josh followup`, `chain-rule.md` before the first `pnpm josh gate` launch it governs (the
// section is how that gate starts, overlapped with the review), and `background-commands.md` before
// the first backgroundable command (`pnpm josh gate`). **They are not deferred or summarized** — the
// named operational section is fetched in the same turn; only `latest-gate.md` remains whole because
// its result branches across that document. `chain-rule.md` governs the `/code-review` → `followup`
// chain and `background-commands.md` the background execution of the gate, the push and the merge
// tail — all *after* the first edit, so neither is resident from the entry. `SKILL.md` → §1, "Four
// documents are read at the point of use", is the single source.
// **`backlogrun`'s own per-child phase documents are point-of-use too**:
// `backlogrun.md` was split so the entry read carries only what binds before the first child, and the
// four phase documents below are read from it at the step each names — dispatching a child, opening a
// lane, the progress watcher and the hand-off, a child that cannot finish — never at the entry. Kept
// out of the count here, exactly as the four above are. `SKILL.md` → §1 is the human source.
// **`backlogrun-steps.md` joins them**: `backlogrun.md` is a manifest and its detailed procedure
// lives in `backlogrun-steps.md`, read on demand rather than at the entry. Counting the manifest's
// pointers into it would put that prose straight back into the entry figure under another name.
// **`pre-gate-cut.md` joins them**: it is the single source of the pre-gate cut, a step a dispatched
// lane child reaches after the entry, so its read is a point-of-use read. Only a lane child reaches
// it: `fullrun.md` does not name it, so it is charged to the lane child's role alone.
// **`progress-watcher.md` joins them**: the heartbeat every implementing run starts once its hold is
// claimed, kept apart from `backlogrun-progress.md` so a single-issue run does not pay for the
// batch's hand-off and waiting procedure to read it.
const POINT_OF_USE_FILES: ReadonlySet<string> = new Set([
	'latest-gate.md',
	'followup.md',
	'chain-rule.md',
	'background-commands.md',
	'pre-gate-cut.md',
	'progress-watcher.md',
	'backlogrun-child.md',
	'backlogrun-lanes.md',
	'backlogrun-progress.md',
	'backlogrun-park.md',
	'backlogrun-steps.md',
	// Read only when a delegated unit goes silent or a lane's pull request conflicts with `main` — a
	// failure path, so a run in which nothing fails never reads it.
	'backlogrun-recovery.md',
	// Read only when `run:step` prints `pnpm josh retrospective` at a run's stop position — the very
	// end of a run, never the entry. Kept out of every entry's read for the
	// same reason the phase documents above are: no run that never drains its backlog reaches it.
	'retrospective.md',
])

// **A file an entry names but reads only later — point-of-use for that entry, an entry read for
// another**. The global set above cannot express this, because a file
// dropped there leaves *every* entry's read. The four ordinary entries read the decision documents
// only when delegation or filing arises; the lane child omits their SKILL.md sections. `backlogrun`'s
// parent additionally reads `fullrun.md` and `split-assessment.md` inside a dispatched child, while
// `fullrun`, `halfrun` and `kickoff` read them at their own entries.
const DEFERRED_DECISIONS: ReadonlySet<string> = new Set(['delegation.md', 'issue-scout.md'])

const POINT_OF_USE_BY_ENTRY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['kickoff', DEFERRED_DECISIONS],
	['fullrun', DEFERRED_DECISIONS],
	['halfrun', DEFERRED_DECISIONS],
	['prrun', DEFERRED_DECISIONS],
	['backlogrun', new Set([...DEFERRED_DECISIONS, 'fullrun.md', 'split-assessment.md'])],
])

const NO_PER_ENTRY_FILES: ReadonlySet<string> = new Set()

// **A file is point-of-use for an entry when the global set names it, or the per-entry map does.**
function is_point_of_use(entry: string, file: string): boolean {
	if (POINT_OF_USE_FILES.has(file)) return true

	return (POINT_OF_USE_BY_ENTRY.get(entry) ?? NO_PER_ENTRY_FILES).has(file)
}

// **Only the global files the entry reaches, plus the ones this entry names in its own row**.
// `cited` is every document the entry's path names; a global file outside it
// is one this entry never opens — a `kickoff` never issues `followup` — so charging it made every
// entry's total the same figure and the per-entry ratchet measured nothing.
function point_of_use_files(entry: string, cited: ReadonlySet<string>): Array<string> {
	const reached = [...POINT_OF_USE_FILES].filter((file) => cited.has(file))

	return [...reached, ...(POINT_OF_USE_BY_ENTRY.get(entry) ?? NO_PER_ENTRY_FILES)]
}

const read_set_point_of_use = {
	POINT_OF_USE_FILES,
	POINT_OF_USE_BY_ENTRY,
	is_point_of_use,
	point_of_use_files,
}

export { read_set_point_of_use }
