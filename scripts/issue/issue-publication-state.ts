import { z } from 'zod'
import { issue_auto_ok } from './issue-auto-ok'
import { AUTO_OK_LABEL, has_label_name } from './issue-labels'

// A body record survives process termination without adding a workflow label or a user prohibition.
const PREFIX = '<!-- josh:publication '
const PATTERN = /<!-- josh:publication (?<record>[^\n]*?) -->/u
const schema = z.object({ labels: z.array(z.string()) })

function is_pending(body: string | undefined): boolean {
	return body?.includes(PREFIX) === true
}

function prepare(body: string, labels: ReadonlyArray<string>): string {
	if (is_pending(body)) throw new Error('Issue already contains a publication record')

	return `${body}\n\n${PREFIX}${JSON.stringify({ labels })} -->\n`
}

function public_body(body: string): string {
	return body.replace(PATTERN, '').trimEnd()
}

function intended_labels(body = ''): ReadonlyArray<string> {
	const record = PATTERN.exec(body)?.groups?.['record']

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
