import type { Classification } from './epic-classify'
import type { EpicChild, GraphAnomaly } from './epic-graph'

// Turning a classification into the answer a caller acts on.
//
// The verdict is what `epicrun` (joshuafolkken/kit#861) branches on, so the three "nothing to run"
// cases are kept apart: waiting, stopping, and being finished are different instructions
// (joshuafolkken/kit#860).

// What the caller should do next.
type EpicVerdict = 'run' | 'wait' | 'stop' | 'complete' | 'error'

interface RepoCandidates {
	repo: string
	children: ReadonlyArray<EpicChild>
	// The local checkout a runner would work in, from joshuafolkken/kit#869's map. Absent when the
	// repository is not checked out here — reported rather than cloned, since creating a working tree
	// nobody asked for is not a step this command takes (joshuafolkken/kit#864).
	path?: string
}

interface EpicNextResult {
	verdict: EpicVerdict
	// Runnable children bundled per repository. How many of one bundle may start at once is the
	// repository's free-lane count, which `epic-lane-offer.ts` decides and this report does not know
	// (joshuafolkken/kit#1491).
	candidates: ReadonlyArray<RepoCandidates>
	waiting: ReadonlyArray<EpicChild>
	blocked_on_people: ReadonlyArray<EpicChild>
	anomalies: ReadonlyArray<GraphAnomaly>
}

// Bundle by repository, repositories in name order, so a run is reproducible rather than dependent
// on the order GitHub happened to list the repositories in. **The children are not re-ordered at
// all** since joshuafolkken/kit#1583 — they keep the order the epic's task list gave them, which is
// how an epic says which of its runnable children goes first; the reasoning is at `bundle_by_repo`
// below.
// The discovery map is keyed lowercase — GitHub resolves owner and repository names
// case-insensitively — so the lookup lowercases too. Without it any capital in a repository name
// printed "no local checkout" for a repository that is checked out (joshuafolkken/kit#864).
//
// `exactOptionalPropertyTypes` rejects `{ path: undefined }`, so the key is added only when there
// is a path to put in it.
function to_path_field(path: string | undefined): { path?: string } {
	return path === undefined ? {} : { path }
}

function bundle_by_repo(
	children: ReadonlyArray<EpicChild>,
	paths: ReadonlyMap<string, string> = new Map(),
): Array<RepoCandidates> {
	const grouped = new Map<string, Array<EpicChild>>()

	for (const child of children) {
		const bucket = grouped.get(child.repo) ?? []

		bucket.push(child)
		grouped.set(child.repo, bucket)
	}

	const repos: Array<string> = []

	for (const [repo] of grouped) repos.push(repo)

	// **The children keep the order they arrived in, which is the order the epic's task list names
	// them** (joshuafolkken/kit#1583). They used to be re-sorted by issue number here, on the premise
	// that number order is split order — true only of an epic whose children were all filed in one
	// split, and false of every epic that grows as work is found: there the number order is *filing*
	// order, and an epic had no way at all to say which of its runnable children should go first.
	//
	// Nothing else had to change to make the body order authoritative: `epic-fetch.ts` →
	// `fetch_children` already reads the task list in body order and `epic-classify.ts` fills
	// `runnable` in that order, so this sort was the one step discarding it.
	//
	// **The repositories are still sorted by name**, which is a different question — that is grouping,
	// not the order work is offered in.
	return repos
		.toSorted((left, right) => left.localeCompare(right))
		.map((repo) => ({
			repo,
			children: grouped.get(repo) ?? [],
			...to_path_field(paths.get(repo.toLowerCase())),
		}))
}

// The verdict, in the order the decision has to be made. Waiting is checked before stopping for the
// reason the categories exist: a run that stops while something is still resolving on its own gives
// up on an epic that was going to finish.
function decide_verdict(classification: Classification, anomalies: number): EpicVerdict {
	if (anomalies > 0) return 'error'
	if (classification.runnable.length > 0) return 'run'
	if (classification.time.length > 0) return 'wait'
	if (classification.human.length > 0) return 'stop'

	return 'complete'
}

// An unusable graph offers nothing. Emptied here rather than left to each caller to check the
// verdict first: a candidate list that is populated while the verdict says `error` is work somebody
// will eventually start, and the anomaly exists to say that nothing may start.
function build_result(
	classification: Classification,
	anomalies: ReadonlyArray<GraphAnomaly>,
	paths: ReadonlyMap<string, string> = new Map(),
): EpicNextResult {
	const verdict = decide_verdict(classification, anomalies.length)

	return {
		verdict,
		candidates: verdict === 'error' ? [] : bundle_by_repo(classification.runnable, paths),
		waiting: classification.time,
		blocked_on_people: classification.human,
		anomalies,
	}
}

// Every runnable child of one repository, in the order they would be offered — **the order the
// epic's own task list names them** (joshuafolkken/kit#1583). It was lowest number first until then,
// on the premise that number order is split order; an epic that gains children as work is found has
// no such property, and the epic could not express a priority at all.
//
// **Priority is not dependency, and this is the difference.** A child high in the list that is stuck
// never reaches `runnable`, so it is skipped rather than blocking the ones below it — which is what a
// declared `blocked-by` chain would do instead, and why an order recorded as a chain stops the batch
// the moment one child needs a person.
//
// The whole bundle rather than only its head, because the confirmation walk needs the rest of it: a
// candidate whose relations listing disagrees with its summary is withheld and the next one is
// confirmed in its place (joshuafolkken/kit#1121).
function candidates_for_repo(result: EpicNextResult, repo: string): ReadonlyArray<EpicChild> {
	return result.candidates.find((bundle) => bundle.repo === repo)?.children ?? []
}

// The repository, with the checkout a runner would use. A repository with no local checkout says so
// rather than being omitted: it is still where the work belongs.
function format_bundle_heading(bundle: RepoCandidates): string {
	return `  ${bundle.repo}  ${bundle.path ?? '(no local checkout)'}`
}

function format_child(child: EpicChild): string {
	return `    #${String(child.number)}`
}

function format_group(label: string, children: ReadonlyArray<EpicChild>): Array<string> {
	if (children.length === 0) return []

	return [label, ...children.map((child) => format_child(child))]
}

const VERDICT_LINES: Readonly<Record<EpicVerdict, string>> = {
	run: 'Runnable children (each takes a free lane in its repository):',
	wait: 'Nothing is runnable yet, but these resolve on their own — wait and ask again:',
	stop: 'Nothing will resolve on its own. These need a person:',
	complete: 'Every child is closed; the epic is complete.',
	error: 'The dependency graph is unusable:',
}

// The report. Every open child appears exactly once, so a caller can see that nothing was dropped.
function format_result(result: EpicNextResult): string {
	if (result.verdict === 'error') {
		return [VERDICT_LINES.error, ...result.anomalies.map((anomaly) => anomaly.message)].join('\n')
	}

	const lines = [VERDICT_LINES[result.verdict]]

	for (const bundle of result.candidates) {
		lines.push(
			format_bundle_heading(bundle),
			...bundle.children.map((child) => format_child(child)),
		)
	}

	lines.push(
		...format_group('  Waiting on time:', result.waiting),
		...format_group('  Waiting on a person:', result.blocked_on_people),
	)

	return lines.join('\n')
}

const epic_report = {
	bundle_by_repo,
	format_bundle_heading,
	decide_verdict,
	build_result,
	candidates_for_repo,
	format_result,
	VERDICT_LINES,
}

export type { EpicNextResult, EpicVerdict, RepoCandidates }
export { epic_report }
