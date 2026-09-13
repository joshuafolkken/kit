import { epic_graph, type EpicChild, type IssueReference } from './epic-graph'

// A blocker no graph in this invocation tracks, weighed rather than ignored (joshuafolkken/kit#1943).
//
// Until this, a relation pointing outside the epic was announced and dropped, so a child waiting on
// another epic's open issue was offered as runnable — `backlogrun` would start joshuafolkken/kit#1936's
// children before joshuafolkken/kit#1921 had restored CI, whatever `blocked-by` said. What decides the
// answer is whether *this run* can finish the blocker: an open blocker the run also runs is `time`
// (waiting resolves it), one it does not is `human` (only a person can), and a blocker whose state was
// never read is `time` rather than runnable, because an unknown is never read as finished.

// What one dependency means for the child that carries it. Declared here rather than in
// `epic-classify.ts` so the two modules share it without importing each other; the classifier
// re-exports both names, so every existing importer is unchanged.
//
// `inherit` is the ordinary answer: the blocker is not finished, so this child's fate is the
// blocker's fate. `time` and `human` are for a dependency that is unresolved for a reason the
// blocker's own state does not show — joshuafolkken/kit#864's case, where a blocker is closed but
// its package has not been published yet, is `time`.
type DependencyVerdict = 'resolved' | 'time' | 'human' | 'inherit'

// The extension point. Replaced wholesale by joshuafolkken/kit#864 to add the publish condition;
// the default knows only that a closed blocker is a finished one.
type ResolveDependency = (blocker: EpicChild, blocked: EpicChild) => DependencyVerdict

type OutsideCategory = 'time' | 'human'

// A line to announce once per invocation, keyed so the classifier's de-duplication can drop repeats.
interface OutsideNotice {
	key: string
	message: string
}

interface OutsideAnswer {
	category: OutsideCategory | undefined
	notice?: OutsideNotice
}

const CLOSED = 'CLOSED'

function name_of(child: EpicChild): string {
	return `#${String(child.number)}`
}

// A closed reference as the child record a resolver takes, so a closed blocker in another repository
// still waits for its release exactly as a tracked one does (joshuafolkken/kit#864).
function as_closed_child(reference: IssueReference): EpicChild {
	return {
		number: reference.number,
		repo: reference.repo,
		state: CLOSED,
		labels: [],
		blocked_by: [],
	}
}

function unread_answer(child: EpicChild, reference: IssueReference): OutsideAnswer {
	const blocker = epic_graph.key_of(reference)

	return {
		category: 'time',
		notice: {
			key: `unread:${epic_graph.key_of(child)}:${blocker}`,
			message: `⚠ ${name_of(child)} is blocked by ${blocker}, whose state could not be read — it waits rather than runs`,
		},
	}
}

function open_answer(
	child: EpicChild,
	reference: IssueReference,
	running: ReadonlySet<string>,
): OutsideAnswer {
	if (running.has(epic_graph.blocker_key(reference))) return { category: 'time' }

	const blocker = epic_graph.key_of(reference)

	return {
		category: 'human',
		notice: {
			key: `outside:${epic_graph.key_of(child)}:${blocker}`,
			message: `⚠ ${name_of(child)} waits on ${blocker}, which this run will not finish — withheld for a person`,
		},
	}
}

function closed_category(verdict: DependencyVerdict): OutsideCategory | undefined {
	if (verdict === 'resolved') return undefined

	return verdict === 'human' ? 'human' : 'time'
}

function outside_category(
	child: EpicChild,
	reference: IssueReference,
	resolve: ResolveDependency,
	running: ReadonlySet<string>,
): OutsideAnswer {
	if (reference.state === undefined) return unread_answer(child, reference)
	if (reference.state !== CLOSED) return open_answer(child, reference, running)

	return { category: closed_category(resolve(as_closed_child(reference), child)) }
}

// The keys of every issue this invocation may run, in the form a blocker reference is looked up by.
function running_keys(issues: ReadonlyArray<IssueReference>): ReadonlySet<string> {
	return new Set(issues.map((issue) => epic_graph.key_of(issue)))
}

const epic_outside_blocker = { outside_category, running_keys }

export type { DependencyVerdict, OutsideAnswer, OutsideNotice, ResolveDependency }
export { epic_outside_blocker }
