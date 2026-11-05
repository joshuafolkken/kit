import { randomUUID } from 'node:crypto'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { review_attest } from './review-attest'
import type { ReviewCheckout } from './review-checkout'
import { review_finding_ledger, type Finding } from './review-finding-ledger'
import { review_finding_text } from './review-finding-text'
import { review_stamps } from './review-stamps'
import { review_stop_log } from './review-stop-log'

// The recorded round's findings and the tree it READ, before its fixes. The ledger keeps the
// correspondence; this checkout-local handoff keeps the blobs needed to print the next fix delta.
const finding_schema = z.object({
	category: z.string(),
	severity: z.string(),
	file: z.string(),
	description: z.string(),
	disposition: z.string().optional(),
})
const round_schema = z.object({
	id: z.string(),
	issue: z.number(),
	snapshot: z.string(),
	findings: z.array(finding_schema),
})
type RecordedRound = z.infer<typeof round_schema>
type DescribedFinding = Finding & { description: string }

function target(root: string): string {
	return stamp_file.stamp_path('josh-review-fix-round-', root)
}

function read(root: string): RecordedRound | undefined {
	const raw = stamp_file.read_stamp_text(target(root)) ?? ''

	return round_schema.safeParse(json_value.parse_or_undefined(raw)).data
}

function snapshot(round: RecordedRound): FileMapStamp | undefined {
	try {
		return file_map_stamp.parse_stamp(round.snapshot)
	} catch {
		return undefined
	}
}

function resume(checkout: ReviewCheckout): RecordedRound | undefined {
	const round = read(checkout.root)
	const stamp = round === undefined ? undefined : snapshot(round)

	if (stamp === undefined || !review_attest.is_briefed_since(stamp.taken_at, checkout.root)) {
		return undefined
	}

	return review_attest.is_attested_on(checkout, checkout.root) ? round : undefined
}

// Description and category identify a finding across shifted line numbers. Ambiguous matches are
// kept separate: an uncertain correspondence must not silently close another finding.
function key(finding: z.infer<typeof finding_schema>): string {
	return JSON.stringify([
		finding.category,
		finding.file.replace(/:\d+(?:-\d+)?$/u, ''),
		finding.description,
	])
}

function correspondence(
	previous: RecordedRound | undefined,
	current: RecordedRound,
): ReadonlyArray<string> {
	const before = previous?.issue === current.issue ? previous.findings : []
	const rows = current.findings.map((finding) => ({
		...finding,
		status: before.filter((old) => key(old) === key(finding)).length === 1 ? 'continuing' : 'new',
	}))
	const resolved = before.filter((old) =>
		current.findings.every((finding) => key(old) !== key(finding)),
	)

	return [...rows, ...resolved.map((finding) => ({ ...finding, status: 'resolved' }))].map(
		(row) =>
			`- rx:${JSON.stringify({ round: current.id, previous: previous?.id, ...row, status: review_finding_ledger.is_closing(row.disposition) ? 'resolved' : row.status })}`,
	)
}

function prepare(
	issue: number,
	findings: ReadonlyArray<Finding & { description?: string }>,
	root: string,
): RecordedRound | undefined {
	const stamp = review_stamps.briefed_stamp.read()

	if (stamp === undefined || !review_attest.is_briefed_since(stamp.taken_at, root)) return undefined

	return {
		id: randomUUID(),
		issue,
		snapshot: JSON.stringify(stamp),
		findings: findings.map((finding) => ({ ...finding, description: finding.description ?? '' })),
	}
}

function save(round: RecordedRound, root: string): void {
	stamp_file.write_stamp(target(root), round)
}

function lines(round: RecordedRound | undefined, root: string): ReadonlyArray<string> {
	return round === undefined ? [] : correspondence(read(root), round)
}

function record_reasons(
	issue: number,
	findings: ReadonlyArray<Finding & { description?: string }>,
): void {
	review_stop_log.record({
		issue,
		stage: 'review:record',
		is_fixed: true,
		findings: findings
			.filter((finding) => (finding.description ?? '').length > 0)
			.map((finding) => ({
				kind: `${finding.category}:${finding.severity}`,
				location: finding.file,
				sentence: review_finding_text.first_sentence(finding.description ?? ''),
			})),
	})
}

const review_fix_round = {
	correspondence,
	lines,
	prepare,
	read,
	record_reasons,
	resume,
	save,
	snapshot,
}

export type { RecordedRound, DescribedFinding }
export { review_fix_round }
