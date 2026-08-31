import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { epic_graph, type EpicChild, type IssueReference } from './epic-graph'

// joshuafolkken/kit#1113: a second look at the relations, taken only where the first one is about to
// become a verdict.
//
// `read_blocked_by` answers from the issue's own `issue_dependencies_summary` when that summary says
// zero, which is what keeps a pass over the whole backlog to one request per issue that declares a
// blocker (joshuafolkken/kit#1024). The summary is GitHub's count, and it can disagree with the
// listing it counts: measured on joshuafolkken/kit#1111, whose summary read `total_blocked_by: 0`
// while `dependencies/blocked_by` returned `#1106`, and where re-POSTing that relation was refused
// with `Target issue has already been taken` — so the relation was real and only the counter was
// wrong. `epic:next` read the epic as self-contradictory, printed `declared but not recorded:
// #1106 -> #1111`, and exited 1. An unattended run stops there, on a graph with nothing to fix.
//
// It corrects nothing else. A relation that is genuinely absent still comes back absent, and the
// mismatch is still reported — the point is that the report is now about the relations rather than
// about a counter.

// A body may legitimately be ahead of its relations — an epic written before `josh` recorded them,
// or one whose recording failed — and `missing_relations` calls that case a mismatch too. There the
// declaration can name every child, so an uncapped recheck fans out one request per child of a
// 200-child epic, concurrently, to confirm what the body already implies. Past this many suspects
// the mismatch is not a stale counter and is reported unchecked: a stale counter is one relation
// GitHub miscounted, not the whole graph.
const RECHECK_LIMIT = 20

// How the caller reads one child's blockers without consulting the summary. Injected so the
// decision above can be tested without a network, and so this module needs no opinion about how a
// child in another repository is addressed.
type BlockersReader = (child: EpicChild) => Promise<Array<IssueReference>>

// The children a declared-but-unrecorded link points at. `link.blocked` is the child whose
// `blocked_by` would have to carry the blocker, so it is the only side worth reading again.
//
// Restricted to `declared_repo` because a declared link is written as a bare number, which names an
// issue in the epic's own repository — `epic_graph` matches those by number alone. An epic tracking
// both `#40` and `owner/other#40` would otherwise have the second child re-read on the first one's
// account, and its relations replaced with a different issue's (joshuafolkken/kit#1014).
function suspect_children(
	children: ReadonlyArray<EpicChild>,
	body: string | undefined,
	declared_repo: string,
): Set<number> {
	const links = git_epic_parse.parse_dependency_links(body)
	const local = children.filter((child) => child.repo === declared_repo)

	return new Set(
		epic_graph.missing_relations(links, local, declared_repo).map((link) => link.blocked),
	)
}

// A read that fails leaves the child exactly as the first read found it, and says so. The mismatch
// is then reported as it was before — the honest answer, since nothing was learned — but a run that
// exits 1 on it should not have to guess whether the correction was even attempted.
async function reread_child(child: EpicChild, read_blockers: BlockersReader): Promise<EpicChild> {
	try {
		return { ...child, blocked_by: await read_blockers(child) }
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)

		console.warn(
			`⚠ could not re-read the blockers of #${String(child.number)}: ${reason}\n` +
				'  a mismatch reported below may be this read failing rather than a missing relation',
		)

		return child
	}
}

// Said out loud for the same reason the failed read is: `epic:next` exits 1 on the mismatch that
// follows, and an operator reading that message should not have to guess whether the correction was
// even attempted.
function skipped_over_limit(
	children: ReadonlyArray<EpicChild>,
	suspect_count: number,
): ReadonlyArray<EpicChild> {
	console.warn(
		`⚠ ${String(suspect_count)} declared links are unrecorded, past the ${String(RECHECK_LIMIT)} this re-reads\n` +
			'  the mismatch below is reported from the first read; the body is likely ahead of the relations',
	)

	return children
}

async function recheck_missing_relations(
	children: ReadonlyArray<EpicChild>,
	body: string | undefined,
	declared_repo: string,
	read_blockers: BlockersReader,
): Promise<ReadonlyArray<EpicChild>> {
	const suspects = suspect_children(children, body, declared_repo)
	if (suspects.size === 0) return children
	if (suspects.size > RECHECK_LIMIT) return skipped_over_limit(children, suspects.size)

	return await Promise.all(
		children.map(async (child) =>
			suspects.has(child.number) && child.repo === declared_repo
				? await reread_child(child, read_blockers)
				: child,
		),
	)
}

const epic_relation_recheck = { recheck_missing_relations, suspect_children, RECHECK_LIMIT }

export type { BlockersReader }
export { epic_relation_recheck }
