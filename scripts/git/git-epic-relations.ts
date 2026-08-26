import type { DependencyLink } from './git-epic-parse'
import { git_gh_command } from './git-gh-command'

// Recording and dropping the native `blocked-by` relations an epic's declared order implies.
//
// The relation is a nicety, not part of the contract: `--add-blocked-by` needs gh >= 2.94.0 and
// losing it costs only the native link, while the Issue and its task list are already correct. A
// failure is therefore counted and reported rather than aborting a batch that is otherwise fine.
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

// What happened, phrased as a count rather than a per-link list: the useful signal is whether the
// native relations now match the body, and a failure means `gh` is too old for every one of them.
function format_relation_report(input: {
	total: number
	failures: number
	action: RelationAction
}): string {
	const verb = describe_action(input.action)

	if (input.failures === 0) {
		return `🔗 ${String(input.total)} blocked-by relation(s) ${verb}.`
	}

	return `⚠️  ${String(input.failures)} of ${String(input.total)} blocked-by relation(s) could not be ${verb} (gh >= 2.94.0 required); the epic body is intact.`
}

const git_epic_relations = {
	apply_relations,
	format_relation_report,
}

export { git_epic_relations }
export type { RelationAction }
