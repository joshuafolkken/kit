import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { poll } from '#scripts/lib/poll'
import { z } from 'zod'

const DECISION_PREFIX = 'josh-openai-lane-supervisor-decision-'
const APPROVAL_POLL_MS = 50
const APPROVAL_POLL_LIMIT = 200
const schema = z.object({
	nonce: z.string(),
	decision: z.enum(['approved', 'cancelled']),
})

type Decision = z.infer<typeof schema>

function target(lane_directory: string, nonce: string): string {
	return stamp_file.stamp_path(`${DECISION_PREFIX}${nonce}-`, lane_directory)
}

function read(lane_directory: string, nonce: string): Decision | undefined {
	const raw = stamp_file.read_stamp_text(target(lane_directory, nonce)) ?? ''

	return json_value.parse_with(raw, schema)
}

function decide(lane_directory: string, nonce: string, decision: Decision['decision']): boolean {
	const value = { nonce, decision }

	return (
		stamp_file.create_stamp(target(lane_directory, nonce), value) ||
		read(lane_directory, nonce)?.decision === decision
	)
}

function approve(lane_directory: string, nonce: string): boolean {
	return decide(lane_directory, nonce, 'approved')
}

function cancel(lane_directory: string, nonce: string): boolean {
	return decide(lane_directory, nonce, 'cancelled')
}

async function is_approved(lane_directory: string, nonce: string): Promise<boolean> {
	const decision = await poll.poll_for(() => read(lane_directory, nonce)?.decision, {
		attempts: APPROVAL_POLL_LIMIT,
		interval_ms: APPROVAL_POLL_MS,
	})

	return decision === 'approved'
}

function remove(lane_directory: string, nonce: string): void {
	stamp_file.remove_stamp(target(lane_directory, nonce))
}

const openai_lane_supervisor_decision = { approve, cancel, is_approved, remove }

export { openai_lane_supervisor_decision }
