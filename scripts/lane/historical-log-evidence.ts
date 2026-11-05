import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_session_action } from '#scripts/lane/lane-session-action'
import { run_board_quota_read } from '#scripts/run/board/run-board-quota-read'
import { run_review_pinned_steps } from '#scripts/run/review/run-review-pinned-steps'
import { z } from 'zod'
import type { EvidenceKind, EvidenceRead, HistoricalEvidence } from './historical-evidence'

// A log's checkout key, rather than a stray issue mention in its text, ties it to the issue.
// Launch headers are evidence of starts only; no completion time is inferred from file metadata.
function timed_line(line: string, source: string, kind: EvidenceKind): Array<HistoricalEvidence> {
	const stamp = run_board_quota_read.line_stamp(line)
	const parsed = z.iso.datetime({ offset: true }).safeParse(stamp)

	return parsed.success ? [{ kind, at: new Date(parsed.data).toISOString(), source }] : []
}

function read_log(source: string, kind: EvidenceKind): EvidenceRead {
	const raw = stamp_file.read_stamp_text(source)
	if (raw === undefined) return { evidence: [], unreadable: [source] }

	return {
		evidence: raw
			.split('\n')
			.flatMap((line, index) => timed_line(line, `${source}:${String(index + 1)}`, kind)),
		unreadable: [],
	}
}

async function read(issue: number): Promise<EvidenceRead> {
	const { directory } = await lane_registry.lane_location(String(issue))
	const review_kind = 'ship-review'
	const results = [
		read_log(lane_session_action.review_paths(directory).log, review_kind),
		read_log(lane_session_action.review_paths(directory, 'interaction').log, review_kind),
		read_log(run_review_pinned_steps.log_path(directory), 'pinned'),
	]

	return {
		evidence: results.flatMap((result) => result.evidence),
		unreadable: results.flatMap((result) => result.unreadable),
	}
}

const historical_log_evidence = { read }

export { historical_log_evidence }
