import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_live } from '#scripts/epic/epic-live'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_publication } from '#scripts/issue/issue-publication'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { error_text } from '#scripts/lib/error-message'

// The judgement and the publication every writer of a `blocked-by` wait shares (joshuafolkken/kit#8222):
// a prepared (open, pending) prerequisite `#M` with no recorded plan would wait unpublished, so the
// wait is refused with the plan command (joshuafolkken/kit#8105); a planned one is published through
// `issue:file --publish`'s own path, the epic listing it. `run:pause` and `backlog:triage` both call
// it; each names its own outcome and rerun, since only the caller knows what it left unwritten.

interface RefusalWording {
	outcome: string
	rerun: string
}

interface Published {
	epic: number
	reason: undefined
}

interface Withheld {
	epic: number | undefined
	reason: string
}

type Publication = Published | Withheld

// Non-widening, so the namespace member keeps the literal type a caller narrows `publish` by.
const NOT_PREPARED = 'not prepared' as const
const NO_EPIC = 'no open epic lists it'

function cite(issue: number | string): string {
	return issue_cite.plain_for('program', issue)
}

// A pending open `#M` and the repository it is published in, or `undefined` when `#M` is not prepared
// here (a cross-repository prerequisite is published from its own checkout) or already closed.
async function prepared_of(
	prerequisite: string,
): Promise<{ repo: string; child: EpicChild } | undefined> {
	if (!issue_number_shape.ISSUE_NUMBER_PATTERN.test(prerequisite)) return undefined
	const repo = await git_gh_command.repo_get_name_with_owner()
	if (repo === undefined) throw new Error('Cannot resolve the publication repository')
	const child = await epic_live.child(Number(prerequisite), repo)

	const is_prepared = child.state === 'OPEN' && issue_publication_state.is_pending(child.body)

	return is_prepared ? { repo, child } : undefined
}

// The plan is judged by publication's own predicate; other withholding reasons are the publish's.
async function plan_refusal(
	prerequisite: string,
	wording: RefusalWording,
): Promise<string | undefined> {
	const prepared = await prepared_of(prerequisite)
	const missing = prepared && issue_publication.missing_plan_of(prepared.child)
	if (missing === undefined) return undefined

	return [
		`Prepared ${cite(prerequisite)} ${missing}: ${wording.outcome}`,
		`Next: \`pnpm josh issue:plan ${prerequisite} --body-file … --planned --no-notify\`, then ${wording.rerun}`,
	].join('\n')
}

// Why `#M` cannot be waited on yet, or `undefined`; a read that fails refuses too, as a reason.
async function refusal(prerequisite: string, wording: RefusalWording): Promise<string | undefined> {
	try {
		return await plan_refusal(prerequisite, wording)
	} catch (error) {
		return `Cannot check the plan of ${cite(prerequisite)}: ${error_text.message_of(error)}`
	}
}

async function publish_first(epics: ReadonlyArray<number>, repo: string): Promise<Publication> {
	const [epic] = epics
	if (epic === undefined) return { epic, reason: NO_EPIC }

	try {
		await issue_publication.publish(epic, repo)

		return { epic, reason: undefined }
	} catch (error) {
		return { epic, reason: error_text.message_of(error) }
	}
}

// The epic listing a prepared `#M` published, or why not; `NOT_PREPARED` leaves `#M` alone.
async function publish(prerequisite: string): Promise<Publication | typeof NOT_PREPARED> {
	const prepared = await prepared_of(prerequisite)
	if (prepared === undefined) return NOT_PREPARED

	return await publish_first(await epic_blocked_by.listing_epics(prerequisite), prepared.repo)
}

const prepared_prerequisite = { cite, publish, refusal, NOT_PREPARED }

export { prepared_prerequisite }
export type { Publication, RefusalWording }
