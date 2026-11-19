import { z } from 'zod'
import { issue_auto_ok } from './issue-auto-ok'
import { AUTO_OK_LABEL, has_label_name, PLAN_UNVERIFIED_LABEL, PLANNED_LABEL } from './issue-labels'

// A body record survives process termination without adding a workflow label or a user prohibition.
// The record is an HTML comment starting its own line outside a fence: the prefix quoted inline or in
// a code block is prose about the record, not one; `prepare` appends it, so the last one is the record
// (joshuafolkken/kit#7573).
const PREFIX = '<!-- josh:publication '
const RECORDS = /^<!-- josh:publication (?<record>[^\n]*?) -->/gmu
const RECORD_LINE = /^<!-- josh:publication /mu
const FENCE_LINE = /^ {0,3}(?<marker>`{3,}|~{3,})/u
const schema = z.object({ labels: z.array(z.string()) })

interface Fence {
	marker: string
	lines: Array<string>
}

interface FenceScan {
	kept: Array<string>
	fence: Fence | undefined
}

function fence_marker(line: string): string | undefined {
	return FENCE_LINE.exec(line)?.groups?.['marker']
}

// A fence closes only on a bare marker of its own character, at least as long as the opener.
function is_close(fence: Fence, line: string): boolean {
	const marker = fence_marker(line) ?? ''
	const is_same = marker.startsWith(fence.marker.charAt(0))

	return is_same && marker.length >= fence.marker.length && line.trim() === marker
}

function continued(fence: Fence, line: string): Fence | undefined {
	if (is_close(fence, line)) return undefined
	fence.lines.push(line)

	return fence
}

function opened(kept: Array<string>, line: string): Fence | undefined {
	const marker = fence_marker(line)
	if (marker === undefined) kept.push(line)

	return marker === undefined ? undefined : { marker, lines: [line] }
}

function scan_line({ kept, fence }: FenceScan, line: string): FenceScan {
	return { kept, fence: fence === undefined ? opened(kept, line) : continued(fence, line) }
}

// An unclosed fence is kept: dropping it would hide the record `prepare` appends after it.
function unfenced(body: string): string {
	let scan: FenceScan = { kept: [], fence: undefined }
	for (const line of body.split('\n')) scan = scan_line(scan, line)

	return [...scan.kept, ...(scan.fence?.lines ?? [])].join('\n')
}

function is_pending(body = ''): boolean {
	return RECORD_LINE.test(unfenced(body))
}

function last_record(body: string): RegExpExecArray | undefined {
	return [...unfenced(body).matchAll(RECORDS)].at(-1)
}

function prepare(body: string, labels: ReadonlyArray<string>): string {
	if (is_pending(body)) throw new Error('Issue already contains a publication record')

	return `${body}\n\n${PREFIX}${JSON.stringify({ labels })} -->\n`
}

// A body rewrite keeps a pending child's record unless the new body brings its own: without it,
// `--publish` would publish the child with none of its intended labels (joshuafolkken/kit#7571).
function carried(previous: string | undefined, next: string): string {
	const record = last_record(previous ?? '')?.[0]
	if (record === undefined || is_pending(next)) return next

	return `${next.trimEnd()}\n\n${record}\n`
}

function public_body(body: string): string {
	const record = last_record(body)?.[0] ?? ''
	const at = body.lastIndexOf(record)

	return `${body.slice(0, at)}${body.slice(at + record.length)}`.trimEnd()
}

function intended_labels(body = ''): ReadonlyArray<string> {
	const record = last_record(body)?.groups?.['record']

	return schema.parse(JSON.parse(record ?? 'null')).labels
}

function labels_of(
	body: string | undefined,
	current: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const intended = intended_labels(body)
	const labels = current.filter((label) => !has_label_name([label], AUTO_OK_LABEL))
	const decision = issue_auto_ok.decide({
		is_opted_out: !has_label_name(intended, AUTO_OK_LABEL),
		is_cross_repository: false,
		body: public_body(body ?? ''),
		labels,
	})

	return decision.is_applied ? [...labels, AUTO_OK_LABEL] : labels
}

function creation(
	body: string,
	labels: ReadonlyArray<string>,
	is_prepared: boolean,
): { body: string; labels: ReadonlyArray<string> } {
	if (!is_prepared) return { body, labels }

	return {
		body: prepare(body, labels),
		labels: labels.filter((label) => !has_label_name([label], AUTO_OK_LABEL)),
	}
}

type PublicationStep = 'epic placement' | 'plan record' | 'publish'

interface PublicationFacts {
	body?: string | undefined
	labels: ReadonlyArray<string>
	has_epic: boolean
}

// A recorded plan lets a pending child publish; `plan:unverified` asks for it again, so it does not
// count. `--publish` and `backlog:plan --pending-publication` share this predicate.
function has_plan_record(labels: ReadonlyArray<string>): boolean {
	return has_label_name(labels, PLANNED_LABEL) && !has_label_name(labels, PLAN_UNVERIFIED_LABEL)
}

// What a pending issue still lacks before it publishes, in the order the steps are taken
// (joshuafolkken/kit#8173): `--publish` reaches only an epic's task list and withholds an unplanned
// child, so an issue in no epic or with no plan is stuck however long it waits. `plan:unverified`
// asks for the plan again, so it does not count as a record. A published issue lacks nothing.
function missing_steps({
	body,
	labels,
	has_epic,
}: PublicationFacts): ReadonlyArray<PublicationStep> {
	if (!is_pending(body)) return []
	const steps: ReadonlyArray<[PublicationStep, boolean]> = [
		['epic placement', has_epic],
		['plan record', has_plan_record(labels)],
		['publish', false],
	]

	return steps.filter(([, is_done]) => !is_done).map(([step]) => step)
}

const issue_publication_state = {
	is_pending,
	has_plan_record,
	missing_steps,
	prepare,
	carried,
	public_body,
	labels_of,
	creation,
}

export type { PublicationFacts, PublicationStep }
export { issue_publication_state }
