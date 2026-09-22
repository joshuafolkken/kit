// Where each agent-read document sits on the execution path, derived from `read:set` — never
// hand-listed (joshuafolkken/kit#2257).
//
// **The per-document byte ceiling could not tell an entry read from a reference document.** A
// document a run reads on every entry costs it every session; one nothing routes to costs it nothing.
// The per-document ceiling held both to the same rule, so a reference document a human browses was
// budgeted as tightly as the workflow text a run actually reads. This splits the corpus so the
// primary budget (`entry-read-budget.ts`) can be the total each entry reads, and the per-document
// ceiling falls back to the documents no entry reaches.
//
// **The split is derived, not transcribed.** `read:set` already computes, per entry, the files it
// reads and the point-of-use documents it reaches — `covered` is that union, plus the resident
// `CLAUDE.md` every entry loads. A document `read:set` never enumerates is `unreached`, and a
// hand-written table of which is which would be the clone `CLAUDE.md` prohibits, drifting the first
// time a trigger table row moved. `CLAUDE.md` is resident by construction rather than by the graph,
// because it is loaded on every request whatever the entry — the misclassification joshuafolkken/kit#2257
// singled out (a bare reachability walk drops it to "off-path", which is wrong).
//
// **The corpus is passed in, never imported here.** This module sits on the runtime path
// (`lint-related` → `document-byte-check` → here), so it may not import `ai-document-fixture` — a test
// fixture the published package excludes (`skill-meta.ts`). `covered_documents` needs no corpus at all
// (it is resident ∪ point-of-use, both from `read:set`); the classification helpers that do enumerate
// the whole corpus take it as an argument, and their only callers are tests, which own the fixture.

import { entry_read_set } from './entry-read-set'

// The always-resident rule document. It is not an entry read — every request carries it — so it is
// named here rather than derived from a trigger table, and the entry-total budget adds it to every
// entry's total so its growth is held (joshuafolkken/kit#2257).
const RESIDENT_BASE: ReadonlyArray<string> = ['CLAUDE.md']
const WORKFLOW_DIRECTORY = '.claude/skills/workflow-commands'

type Reachability = 'resident' | 'point-of-use' | 'unreached'

// The trigger table names the workflow documents by base name (`fullrun.md`, `SKILL.md`); they all
// live in the workflow-commands skill, so the corpus path is that directory plus the name.
function workflow_path(name: string): string {
	return `${WORKFLOW_DIRECTORY}/${name}`
}

// Every base name `read:set` reads at an entry — the files across all trigger-table entries and the
// referenced sections those files point out to. Point-of-use names are handled on their own below.
function names_of(set: ReturnType<typeof entry_read_set.read_set>): Array<string> {
	return [...set.files, ...set.sections.map((reference) => reference.file)]
}

function entry_read_names(root: string): Set<string> {
	const names = entry_read_set
		.entries(root)
		.flatMap((entry) => names_of(entry_read_set.read_set(root, entry)))

	return new Set(names)
}

function resident_documents(root: string): Set<string> {
	return new Set([
		...RESIDENT_BASE,
		...[...entry_read_names(root)].map((name) => workflow_path(name)),
	])
}

function point_of_use_documents(): Set<string> {
	return new Set([...entry_read_set.POINT_OF_USE_FILES].map((name) => workflow_path(name)))
}

function label_of(
	relative_path: string,
	resident: ReadonlySet<string>,
	point_of_use: ReadonlySet<string>,
): Reachability {
	if (resident.has(relative_path)) return 'resident'

	return point_of_use.has(relative_path) ? 'point-of-use' : 'unreached'
}

// Every document in the given corpus mapped to where it sits on the execution path. The corpus is
// passed in (the caller owns `agent_read_documents`) so this runtime module carries no fixture import.
function classify(
	corpus: ReadonlyArray<string>,
	root: string = process.cwd(),
): Map<string, Reachability> {
	const resident = resident_documents(root)
	const point_of_use = point_of_use_documents()

	return new Map(corpus.map((one) => [one, label_of(one, resident, point_of_use)]))
}

function documents_labelled(
	label: Reachability,
	corpus: ReadonlyArray<string>,
	root: string = process.cwd(),
): Array<string> {
	return [...classify(corpus, root)]
		.filter(([, value]) => value === label)
		.map(([one]) => one)
		.toSorted((left, right) => left.localeCompare(right))
}

// The documents an entry reads — resident plus point-of-use. The entry-total budget governs these;
// the per-document ceiling falls back to the unreached rest, so neither holds a document the other
// does (joshuafolkken/kit#2257). Both sides come from `read:set`, so no corpus is needed — which is
// what keeps the runtime caller (`document-byte-check`) free of the fixture the corpus lives in.
function covered_documents(root: string = process.cwd()): Array<string> {
	return [...new Set([...resident_documents(root), ...point_of_use_documents()])].toSorted(
		(left, right) => left.localeCompare(right),
	)
}

function unreached_documents(
	corpus: ReadonlyArray<string>,
	root: string = process.cwd(),
): Array<string> {
	return documents_labelled('unreached', corpus, root)
}

const document_reachability = {
	RESIDENT_BASE,
	classify,
	covered_documents,
	documents_labelled,
	unreached_documents,
}

export type { Reachability }
export { document_reachability }
