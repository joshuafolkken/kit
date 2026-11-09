import { epic_index } from '#scripts/epic/epic-index'
import { epic_promote } from '#scripts/epic/epic-promote'
import { epic_untrack } from '#scripts/epic/epic-untrack'
import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'
import { issue_body_or_comment } from './issue-body-or-comment'
import { EPIC_LABEL, label_name_of } from './issue-labels'
import { session_cite } from './session-cite'

// `josh issue:consolidate` — fold duplicate issues into one target through the existing write
// primitives: each duplicate leaves the epics that track it and is closed as not planned with a
// pointer to the target; the target takes the new title and body, and `--demote` turns it back
// from an epic into a plain issue.
//
// **Every read comes before the first write**, so a missing target, an untrusted author or an
// incomplete epic listing refuses with nothing written. A write that fails after that stops the run
// and names the writes that already landed, since GitHub keeps them.

interface ConsolidateRequest {
	target: number
	duplicates: ReadonlyArray<number>
	title: string | undefined
	body: string | undefined
	is_demote: boolean
}

const TARGET_FIELDS = `body,labels,${gh_author_association.AUTHOR_FIELDS}`
const EPIC_LIMIT = 200
const COMPLETE_LISTING = 'none'
const SUCCESS = 0
const NOTHING_WRITTEN = 'nothing was written'
const PROMOTED_LINE = new RegExp(String.raw`^${epic_promote.PROMOTED_HEADING}\s*$`, 'mu')

const target_schema = z.looseObject({
	body: z.string().nullish(),
	labels: z.array(issue_label_schema).optional(),
	...gh_author_association.author_fields_schema,
})

type Target = z.infer<typeof target_schema>
type Tracking = ReadonlyMap<number, ReadonlyArray<number>>

function parse_target(json: string | undefined): Target | undefined {
	return json === undefined ? undefined : parse_json_object_or_undefined(json, target_schema)
}

async function read_target(request: ConsolidateRequest): Promise<Target> {
	const cite = session_cite.issue(request.target)
	const target = parse_target(
		await git_gh_command.issue_view_json(String(request.target), TARGET_FIELDS),
	)

	if (target === undefined) throw new Error(`Could not read ${cite} — ${NOTHING_WRITTEN}.`)

	if (request.body === undefined || (await issue_body_or_comment.is_author_trusted(target))) {
		return target
	}

	throw new Error(`${cite} was filed by an author without write access — ${NOTHING_WRITTEN}.`)
}

// An epic past the listing's cut would keep tracking a closed duplicate, so a short read refuses.
async function read_tracking(): Promise<Tracking> {
	const fetched = await epic_index.fetch_epics(EPIC_LIMIT)

	if (fetched?.cutoff !== COMPLETE_LISTING) {
		throw new Error(`The open epics could not be read in full — ${NOTHING_WRITTEN}.`)
	}

	return epic_index.build_tracking_index(fetched.epics)
}

// The epic sections `epic --promote` appends start at its heading and run to the end of the body.
function demoted(body: string): string {
	const at = body.search(PROMOTED_LINE)

	return at === -1 ? body : `${body.slice(0, at).trimEnd()}\n`
}

function next_body(request: ConsolidateRequest, current: string): string | undefined {
	const base = request.body ?? current
	const body = request.is_demote ? demoted(base) : base

	return body === current ? undefined : body
}

function landed(action: () => Promise<unknown>): () => Promise<boolean> {
	return async () => {
		await action()

		return true
	}
}

async function is_landed(did_land: () => Promise<boolean>): Promise<boolean> {
	try {
		return await did_land()
	} catch (error) {
		console.error(error_text.message_of(error))

		return false
	}
}

async function write(
	done: Array<string>,
	step: string,
	did_land: () => Promise<boolean>,
): Promise<void> {
	if (!(await is_landed(did_land))) throw new Error(`Failed: ${step}.`)
	done.push(step)
}

async function demote_label(
	request: ConsolidateRequest,
	target: Target,
	done: Array<string>,
): Promise<void> {
	if (!request.is_demote) return
	const names = (target.labels ?? []).map((label) => label.name)
	const stored = label_name_of(names, EPIC_LABEL)

	if (stored === undefined) return
	const issue = String(request.target)

	await write(
		done,
		`${session_cite.issue(issue)} \`${EPIC_LABEL}\` label removed`,
		landed(async () => {
			await git_gh_command.issue_remove_label(issue, stored)
		}),
	)
}

async function rewrite_target(
	request: ConsolidateRequest,
	target: Target,
	done: Array<string>,
): Promise<void> {
	const issue = String(request.target)
	const cite = session_cite.issue(issue)
	const { title } = request
	const body = next_body(request, target.body ?? '')

	if (title !== undefined) {
		await write(
			done,
			`${cite} title`,
			landed(async () => await git_gh_command.issue_edit_title(issue, title)),
		)
	}

	if (body !== undefined) {
		await write(
			done,
			`${cite} body`,
			landed(async () => await git_gh_command.issue_edit_body(issue, body)),
		)
	}

	await demote_label(request, target, done)
}

async function untrack_duplicate(
	duplicate: number,
	tracking: Tracking,
	done: Array<string>,
): Promise<void> {
	const cite = session_cite.issue(duplicate)
	const epics = new Set(tracking.get(duplicate))

	for (const epic of epics) {
		// eslint-disable-next-line no-await-in-loop -- a failed write stops the run before the next one
		await write(done, `${cite} untracked from epic ${session_cite.issue(epic)}`, async () => {
			return (await epic_untrack.untrack(epic, [duplicate])) === SUCCESS
		})
	}
}

async function close_duplicate(
	target: number,
	duplicate: number,
	done: Array<string>,
): Promise<void> {
	const comment = `Consolidated into ${session_cite.issue(target)}.`

	await write(done, `${session_cite.issue(duplicate)} closed as not planned`, async () => {
		return await git_gh_command.issue_close(String(duplicate), comment, 'not_planned')
	})
}

// The epic rows go first, before the target is rewritten: a demoted or rewritten target epic no
// longer tracks its duplicates, so its untrack would refuse. A failed untrack leaves every duplicate
// open, so a re-run finds them again.
async function apply(request: ConsolidateRequest, done: Array<string>): Promise<void> {
	const target = await read_target(request)
	const tracking = await read_tracking()

	for (const duplicate of request.duplicates) {
		// eslint-disable-next-line no-await-in-loop -- a failed write stops the run before the next one
		await untrack_duplicate(duplicate, tracking, done)
	}

	await rewrite_target(request, target, done)

	for (const duplicate of request.duplicates) {
		// eslint-disable-next-line no-await-in-loop -- a failed write stops the run before the next one
		await close_duplicate(request.target, duplicate, done)
	}
}

function step_lines(done: ReadonlyArray<string>): string {
	return done.map((step) => `  - ${step}`).join('\n')
}

function report_failure(error: unknown, done: ReadonlyArray<string>): void {
	console.error(`✖ ${error_text.message_of(error)}`)
	if (done.length === 0) return
	console.error(`Already written — not undone:\n${step_lines(done)}`)
}

// Exit code: 0 when every write landed, 1 when a read refused or a write failed.
async function consolidate(request: ConsolidateRequest): Promise<number> {
	const done: Array<string> = []

	try {
		await apply(request, done)
	} catch (error) {
		report_failure(error, done)

		return 1
	}

	console.info(`✔ Consolidated into ${session_cite.issue(request.target)}:\n${step_lines(done)}`)

	return SUCCESS
}

const issue_consolidate = { consolidate }

export { issue_consolidate }
export type { ConsolidateRequest }
