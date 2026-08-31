import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { epic_graph, type EpicChild, type IssueReference } from './epic-graph'

// Sorting an epic's open children into what a caller should do about them.
//
// The categories are decided by *whether waiting helps*, never by which label a child carries. The
// difference is not academic: the moment kit's child closes and app-kit's child is waiting for the
// release to publish, there is no runnable child, nothing carries `in-progress` (kit's child is
// closed) and nothing carries `needs-decision` (nothing was parked). A label-based reading sees
// "nothing running, nothing parked" and stops — in the one situation where it should wait
// (joshuafolkken/kit#860).

// What a caller does with a child: run it, wait for it, or stop and report it.
type ChildCategory = 'runnable' | 'time' | 'human' | 'done'

// What one dependency means for the child that carries it.
//
// `inherit` is the ordinary answer: the blocker is not finished, so this child's fate is the
// blocker's fate. `time` and `human` are for a dependency that is unresolved for a reason the
// blocker's own state does not show — joshuafolkken/kit#864's case, where a blocker is closed but
// its package has not been published yet, is `time`.
type DependencyVerdict = 'resolved' | 'time' | 'human' | 'inherit'

// The extension point. Replaced wholesale by joshuafolkken/kit#864 to add the publish condition;
// the default here knows only that a closed blocker is a finished one.
type ResolveDependency = (blocker: EpicChild, blocked: EpicChild) => DependencyVerdict

interface Classification {
	runnable: ReadonlyArray<EpicChild>
	time: ReadonlyArray<EpicChild>
	human: ReadonlyArray<EpicChild>
}

const CLOSED = 'CLOSED'

// The default resolver: a closed blocker is resolved, anything else defers to the blocker itself.
function resolve_by_state(blocker: EpicChild): DependencyVerdict {
	return blocker.state === CLOSED ? 'resolved' : 'inherit'
}

function has_label(child: EpicChild, label: string): boolean {
	return child.labels.includes(label)
}

// What a child is before its dependencies are considered. A parked child is `human` whatever blocks
// it, and a child already being worked on is `time` — someone else's session will finish it.
function local_category(child: EpicChild): ChildCategory | undefined {
	if (child.state === CLOSED) return 'done'
	if (has_label(child, NEEDS_DECISION_LABEL)) return 'human'
	if (has_label(child, IN_PROGRESS_LABEL)) return 'time'

	return undefined
}

// A blocker's category, as it applies to whatever it blocks. A blocker that is runnable or already
// done is one that waiting resolves, so it reads as `time` for the child behind it.
function inherited_category(blocker_category: ChildCategory): ChildCategory {
	return blocker_category === 'human' ? 'human' : 'time'
}

// What one dependency contributes: nothing when resolved, otherwise the category it forces.
function dependency_category(
	verdict: DependencyVerdict,
	blocker_category: ChildCategory,
): ChildCategory | undefined {
	if (verdict === 'resolved') return undefined
	if (verdict === 'inherit') return inherited_category(blocker_category)

	return verdict
}

// The context one classification pass carries: the graph, the resolver, and the answers so far.
interface ClassifyContext {
	index: ReadonlyMap<string, EpicChild>
	resolve: ResolveDependency
	// Keyed by identity — repository plus number — because two children of one epic can share a
	// number across repositories (joshuafolkken/kit#864).
	memo: Map<string, ChildCategory>
}

// A blocker this epic does not track as a child. Said out loud rather than dropped in silence: the
// relation is real, the graph has nothing to order it against, and a reader watching an unattended
// run start that child should be able to see what was not weighed (joshuafolkken/kit#1126).
//
// Whether such a blocker should hold the child back at all is a separate question, and it belongs to
// joshuafolkken/kit#1123 — this reports, it does not decide.
// Announced once per invocation rather than once per pass. One `epic:next --repo` classifies the same
// children several times — the report, the candidate confirmation, and once per candidate it withholds
// — so an unguarded warning said the same thing up to four times, in two wordings.
const reported = new Set<string>()

// Discard what has been announced. Called once per command invocation, beside
// `epic_cross_repo.reset_publish_cache`, for the same reason: a long-lived process must not go quiet
// about a relation it is still ignoring.
function reset_reported(): void {
	reported.clear()
}

function report_untracked(child: EpicChild, blocker: IssueReference): void {
	const line = `${epic_graph.key_of(child)}:${epic_graph.key_of(blocker)}`
	if (reported.has(line)) return

	reported.add(line)
	console.warn(
		`⚠ #${String(child.number)} is blocked by ${epic_graph.key_of(blocker)}, ` +
			'which this epic does not track — the dependency is not weighed',
	)
}

// What one recorded relation contributes. A blocker inside the epic is resolved through the caller's
// resolver; one outside it is reported and contributes nothing.
function relation_category(
	child: EpicChild,
	blocker_reference: IssueReference,
	context: ClassifyContext,
): ChildCategory | undefined {
	const blocker = context.index.get(epic_graph.blocker_key(blocker_reference))

	if (blocker === undefined) {
		report_untracked(child, blocker_reference)

		return undefined
	}

	return dependency_category(
		context.resolve(blocker, child),
		context.memo.get(epic_graph.key_of(blocker)) ?? 'time',
	)
}

// The categories every blocker inside the epic forces on `child`. Reads the memo rather than
// recursing: the loop below categorizes in dependency order, so every blocker already has an answer.
function blocker_categories(child: EpicChild, context: ClassifyContext): Array<ChildCategory> {
	return child.blocked_by
		.map((blocker) => relation_category(child, blocker, context))
		.filter((category): category is ChildCategory => category !== undefined)
}

// The category the blockers add up to. `human` wins over `time`: a child waiting on both a parked
// blocker and a running one cannot proceed on time alone, and calling it merely waiting would have
// a caller wait for something only a person can release.
function from_blockers(categories: ReadonlyArray<ChildCategory>): ChildCategory {
	if (categories.includes('human')) return 'human'

	return categories.length > 0 ? 'time' : 'runnable'
}

function compute_category(child: EpicChild, context: ClassifyContext): ChildCategory {
	return local_category(child) ?? from_blockers(blocker_categories(child, context))
}

// Whether every blocker of `node` inside the epic already has a category.
function is_ready(node: string, context: ClassifyContext): boolean {
	return epic_graph
		.blockers_of(context.index, node)
		.every((blocker) => !context.index.has(blocker) || context.memo.has(blocker))
}

// Categorize in dependency order by peeling, the same way the cycle check does. Iterative on
// purpose: the recursive form is a mutually recursive pair, and a cycle would make it never return.
function fill_memo(children: ReadonlyArray<EpicChild>, context: ClassifyContext): void {
	const pending = new Set(children.map((child) => epic_graph.key_of(child)))

	const peel = (): number => {
		const ready = [...pending].filter((node) => is_ready(node, context))

		for (const node of ready) {
			const child = context.index.get(node)

			if (child !== undefined) context.memo.set(node, compute_category(child, context))
			pending.delete(node)
		}

		return ready.length
	}

	while (peel() > 0) {
		/* keep going until a pass categorizes nothing */
	}

	// Only a cycle leaves anything here, and `find_anomalies` rejects one before this runs. Marking
	// the remainder as waiting rather than dropping it keeps the buckets accounting for every child.
	for (const node of pending) context.memo.set(node, 'time')
}

// Every open child, sorted. Closed children are simply absent — they are the part of the epic that
// is finished, and a caller has nothing to do with them.
function classify_children(
	children: ReadonlyArray<EpicChild>,
	resolve: ResolveDependency = resolve_by_state,
): Classification {
	const context: ClassifyContext = {
		index: epic_graph.index_children(children),
		resolve,
		memo: new Map<string, ChildCategory>(),
	}
	const buckets: Record<'runnable' | 'time' | 'human', Array<EpicChild>> = {
		runnable: [],
		time: [],
		human: [],
	}

	fill_memo(children, context)

	for (const child of children) {
		const category = context.memo.get(epic_graph.key_of(child)) ?? 'time'

		if (category !== 'done') buckets[category].push(child)
	}

	return buckets
}

const epic_classify = {
	resolve_by_state,
	reset_reported,
	local_category,
	classify_children,
}

export type { Classification, ChildCategory, DependencyVerdict, ResolveDependency }
export { epic_classify }
