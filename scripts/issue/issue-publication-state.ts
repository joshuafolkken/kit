import { z } from 'zod'
import { issue_auto_ok } from './issue-auto-ok'
import { AUTO_OK_LABEL, has_label_name } from './issue-labels'

// A body record survives process termination without adding a workflow label or a user prohibition.
// The record is an HTML comment starting its own line outside a fence: the prefix quoted inline or in
// a code block is prose about the record, not one; `prepare` appends it, so the last one is the record
// (joshuafolkken/kit#7573).
const PREFIX = '<!-- josh:publication '
const RECORDS = /^<!-- josh:publication (?<record>[^\n]*?) -->/gmu
const RECORD_LINE = /^<!-- josh:publication /mu
const FENCE_LINE = /^ {0,3}(?:```|~~~)/u
const schema = z.object({ labels: z.array(z.string()) })

function unfenced(body: string): string {
	let is_fenced = false

	return body
		.split('\n')
		.filter((line) => {
			const is_fence = FENCE_LINE.test(line)
			if (is_fence) is_fenced = !is_fenced

			return !is_fence && !is_fenced
		})
		.join('\n')
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

const issue_publication_state = { is_pending, prepare, public_body, labels_of, creation }

export { issue_publication_state }
