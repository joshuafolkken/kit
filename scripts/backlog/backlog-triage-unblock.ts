import { epic_blocked_by, type BlockedByRequest } from '#scripts/epic/epic-blocked-by'
import { epic_parse } from '#scripts/epic/epic-parse'
import { epic_read } from '#scripts/epic/epic-read'
import { epic_remove } from '#scripts/epic/epic-remove'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { session_cite } from '#scripts/issue/session-cite'

// `backlog:triage --unblock`'s write (joshuafolkken/kit#5818): `#issue` no longer blocked by
// `#prerequisite` — the undo of `epic_blocked_by.record`, so removing a relation is reversible by
// `--blocked-by`. Every epic listing `#issue` that declares `#prerequisite -> #issue` drops the
// declaration through `epic --remove`'s path (`epic_remove.remove_order`), which deletes the relation
// it backs; the relation is then deleted directly, for the issue no epic declares it on.
//
// **The declaration goes before the relation**: a relation left behind a dropped declaration is
// deleted by a rerun, while a declaration left behind a deleted relation would be re-recorded by
// `epic --reconcile`. The delete endpoint answers success on an absent relation, so a rerun after a
// failure finishes what is left. Failures throw, the message naming the write that failed.

const SUCCESS_EXIT_CODE = 0

async function is_declared(epic: number, request: BlockedByRequest): Promise<boolean> {
	const reading = await epic_read.read_epic(epic)

	if ('error' in reading) {
		throw new Error(`epic ${session_cite.issue(epic)} could not be read: ${reading.error}`)
	}

	return epic_parse
		.parse_dependency_links(reading.subject.body)
		.some(
			(link) =>
				link.blocker === Number(request.prerequisite) && link.blocked === Number(request.issue),
		)
}

async function drop_declaration(epic: number, request: BlockedByRequest): Promise<void> {
	if (!(await is_declared(epic, request))) return

	const path = [Number(request.prerequisite), Number(request.issue)]
	const code = await epic_remove.remove_order({ epic_number: epic, path })

	if (code === SUCCESS_EXIT_CODE) return

	throw new Error(`\`epic --remove\` on ${session_cite.issue(epic)} failed to drop the declaration`)
}

// Each epic listing `#issue` is a separate body, so their declarations are dropped side by side.
async function drop_declarations(request: BlockedByRequest): Promise<void> {
	const epics = await epic_blocked_by.listing_epics(request.issue)

	await Promise.all(
		epics.map(async (epic) => {
			await drop_declaration(epic, request)
		}),
	)
}

async function remove(request: BlockedByRequest): Promise<void> {
	await drop_declarations(request)

	if (await git_gh_issue_write.issue_remove_blocked_by(request.issue, request.prerequisite)) return

	throw new Error('the blocked-by relation was not removed')
}

const backlog_triage_unblock = { remove }

export { backlog_triage_unblock }
