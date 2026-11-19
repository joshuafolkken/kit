import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { prepared_prerequisite } from '#scripts/issue/prepared-prerequisite'
import { run_pause_comment } from './run-pause-comment'

// The `run:pause` step that keeps a prepared prerequisite from waiting unseen (joshuafolkken/kit#8086):
// a pending `#N` is published through `issue:file --publish`'s own path, the epic listing it, and
// when that is withheld the reason and the next commands go on `#M` and `#N` once each, by marker.
// The judgement and the publication are `prepared_prerequisite`'s, shared with `backlog:triage`.

interface PublishRequest {
	issue: string
	prerequisite: string
}

const { cite, NOT_PREPARED } = prepared_prerequisite

const PAUSE_WORDING = { outcome: 'nothing was set aside.', rerun: 'rerun this pause' }

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

// Why `run:pause` refuses before any step (joshuafolkken/kit#8105): a prepared `#N` with no recorded
// plan would wait unpublished until a person planned it, so the lane that filed it records the plan
// first; other withholding reasons stay notes. A failed read refuses too, reported like a failed step.
async function unplanned(request: PublishRequest): Promise<string | undefined> {
	return await prepared_prerequisite.refusal(request.prerequisite, PAUSE_WORDING)
}

async function publish_prepared(request: PublishRequest): Promise<string> {
	const publication = await prepared_prerequisite.publish(request.prerequisite)
	if (publication === NOT_PREPARED) return NOT_PREPARED

	const { epic, reason } = publication
	if (reason === undefined) return `published ${cite(epic)}`

	const note = note_of(request, epic, reason)

	await leave_note(request, note)
	console.warn(note)

	return `withheld: ${reason}`
}

const run_pause_publish = { publish_prepared, unplanned, NOT_PREPARED }

export { run_pause_publish }
