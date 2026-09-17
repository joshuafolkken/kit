import type { DependencyLink } from './git-epic-parse'
import { format_dependency_links } from './git-epic-reference'
import { git_gh_command } from './git-gh-command'

// Recording and dropping the native `blocked-by` relations an epic's declared order implies.
//
// The relation is a nicety, not part of the contract: losing it costs only the native link, while
// the Issue and its task list are already correct. A failure is therefore counted and reported
// rather than aborting a batch that is otherwise fine. It no longer depends on the gh CLI's version
// — the relation is written through the REST dependencies endpoint (joshuafolkken/kit#1026).
//
// Shared by epic creation and `--add` rather than written once per caller: both apply the same
// relations for the same reason, and a second copy would be the place a fix is forgotten
// (joshuafolkken/kit#890).

type RelationAction = 'record' | 'drop'

async function apply_one(link: DependencyLink, action: RelationAction): Promise<boolean> {
	const blocked = String(link.blocked)
	const blocker = String(link.blocker)

	return action === 'record'
		? await git_gh_command.issue_add_blocked_by(blocked, blocker)
		: await git_gh_command.issue_remove_blocked_by(blocked, blocker)
}

// How many of the relations could not be applied. Applied concurrently, as epic creation already
// does: they are independent edits on different issues.
async function apply_relations(
	links: ReadonlyArray<DependencyLink>,
	action: RelationAction,
): Promise<number> {
	if (links.length === 0) return 0

	const applied = await Promise.all(links.map(async (link) => await apply_one(link, action)))

	return applied.filter((is_applied) => !is_applied).length
}

function describe_action(action: RelationAction): string {
	return action === 'record' ? 'recorded' : 'removed'
}

// What happened, and to which pairs. The count used to stand on its own, and a count cannot be
// checked: an insertion that recorded an order nobody declared printed the same
// `1 blocked-by relation(s) recorded.` as a correct one, so the invented chains of
// joshuafolkken/kit#1080 were caught only by whoever thought to open the epic body afterwards. The
// links are named in the `#blocker -> #blocked` form the declaration itself uses, so the reader
// compares like with like.
//
// The failure line still carries no list: `apply_relations` reports how many writes failed and not
// which, so naming the whole set there would assert more than is known.
function format_relation_report(input: {
	links: ReadonlyArray<DependencyLink>
	failures: number
	action: RelationAction
}): string {
	const verb = describe_action(input.action)
	const total = String(input.links.length)

	// Nothing to name. Every caller already skips the report on an empty list, but the invariant
	// belongs with the message rather than with each of them.
	if (input.links.length === 0) return `🔗 No blocked-by relation was ${verb}.`

	if (input.failures === 0) {
		return `🔗 ${total} blocked-by relation(s) ${verb}: ${format_dependency_links(input.links)}.`
	}

	return `⚠️  ${String(input.failures)} of ${total} blocked-by relation(s) could not be ${verb}; the epic body is intact.`
}

const git_epic_relations = {
	apply_relations,
	format_relation_report,
}

export { git_epic_relations }
export type { RelationAction }
