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
	// Runnable children bundled per repository, so a caller can run one per repository in parallel.
	candidates: ReadonlyArray<RepoCandidates>
	waiting: ReadonlyArray<EpicChild>
	blocked_on_people: ReadonlyArray<EpicChild>
	anomalies: ReadonlyArray<GraphAnomaly>
}

// Bundle by repository, repositories in name order and children in number order, so a run is
// reproducible rather than dependent on the order GitHub happened to list the children in.
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

	return repos
		.toSorted((left, right) => left.localeCompare(right))
		.map((repo) => ({
			repo,
			children: (grouped.get(repo) ?? []).toSorted((left, right) => left.number - right.number),
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

// The single candidate for one repository, for a caller that runs one repository at a time. Lowest
// number first, which is the order the children were split in.
function pick_for_repo(result: EpicNextResult, repo: string): EpicChild | undefined {
	return result.candidates.find((bundle) => bundle.repo === repo)?.children[0]
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
	run: 'Runnable children (one per repository may run at a time):',
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
	pick_for_repo,
	format_result,
	VERDICT_LINES,
}

export type { EpicNextResult, EpicVerdict, RepoCandidates }
export { epic_report }
