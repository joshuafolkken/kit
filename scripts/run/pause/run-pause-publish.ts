import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { epic_live } from '#scripts/epic/epic-live'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_publication } from '#scripts/issue/issue-publication'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { error_text } from '#scripts/lib/error-message'
import { run_pause_comment } from './run-pause-comment'

// The `run:pause` step that keeps a prepared prerequisite from waiting unseen (joshuafolkken/kit#8086):
// a pending `#N` is published through `issue:file --publish`'s own path, the epic listing it, and
// when that is withheld the reason and the next commands go on `#M` and `#N` once each, by marker.

interface PublishRequest {
	issue: string
	prerequisite: string
}

const NOT_PREPARED = 'not prepared'
const NO_EPIC = 'no open epic lists it'

function cite(issue: number | string): string {
	return issue_cite.plain_for('program', issue)
}

function marker_of({ issue, prerequisite }: PublishRequest): string {
	return `<!-- josh:run-pause-publish ${cite(issue)} -> ${cite(prerequisite)} -->`
}

function note_of(request: PublishRequest, epic: number | undefined, reason: string): string {
	const target = epic === undefined ? '<epic>' : String(epic)

	return [
		marker_of(request),
		`Prepared ${cite(request.prerequisite)} (awaited by ${cite(request.issue)}) is not published: ${reason}`,
		`Next: \`pnpm josh issue:plan ${request.prerequisite} … --planned --no-notify\`, then \`pnpm josh issue:file --publish ${target}\``,
	].join('\n')
}

async function publish_first(
	epics: ReadonlyArray<number>,
	repo: string,
): Promise<{ epic: number; reason: undefined } | { epic: number | undefined; reason: string }> {
	const [epic] = epics
	if (epic === undefined) return { epic, reason: NO_EPIC }

	try {
		await issue_publication.publish(epic, repo)

		return { epic, reason: undefined }
	} catch (error) {
		return { epic, reason: error_text.message_of(error) }
	}
}

async function leave_note(request: PublishRequest, note: string): Promise<void> {
	const marker = marker_of(request)

	for (const issue of [request.issue, request.prerequisite]) {
		// eslint-disable-next-line no-await-in-loop -- one marker check per issue, each settled before the next
		if (!(await run_pause_comment.has_comment({ issue, marker }))) {
			// eslint-disable-next-line no-await-in-loop -- posted once per issue, in order
			await git_gh_issue_write.issue_comment(issue, note)
		}
	}
}

// The repository a pending `#N` is published in, or `undefined` when `#N` is not prepared here (a
// cross-repository prerequisite is published from its own checkout).
async function prepared_repo(prerequisite: string): Promise<string | undefined> {
	if (!issue_number_shape.ISSUE_NUMBER_PATTERN.test(prerequisite)) return undefined
	const repo = await git_gh_command.repo_get_name_with_owner()
	if (repo === undefined) throw new Error('Cannot resolve the publication repository')
	const child = await epic_live.child(Number(prerequisite), repo)

	return issue_publication_state.is_pending(child.body) ? repo : undefined
}

async function publish_prepared(request: PublishRequest): Promise<string> {
	const repo = await prepared_repo(request.prerequisite)
	if (repo === undefined) return NOT_PREPARED

	const { epic, reason } = await publish_first(
		await epic_blocked_by.listing_epics(request.prerequisite),
		repo,
	)
	if (reason === undefined) return `published ${cite(epic)}`

	const note = note_of(request, epic, reason)

	await leave_note(request, note)
	console.warn(note)

	return `withheld: ${reason}`
}

const run_pause_publish = { publish_prepared, NOT_PREPARED }

export { run_pause_publish }
