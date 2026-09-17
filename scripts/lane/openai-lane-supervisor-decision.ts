import { stamp_file } from '#scripts/josh/stamp-file'
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
	try {
		const raw = stamp_file.read_stamp_text(target(lane_directory, nonce)) ?? ''
		const value: unknown = JSON.parse(raw)

		return schema.parse(value)
	} catch {
		return undefined
	}
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
	for (let attempt = 0; attempt < APPROVAL_POLL_LIMIT; attempt += 1) {
		const decision = read(lane_directory, nonce)?.decision
		if (decision !== undefined) return decision === 'approved'

		await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_MS))
	}

	return false
}

function remove(lane_directory: string, nonce: string): void {
	stamp_file.remove_stamp(target(lane_directory, nonce))
}

const openai_lane_supervisor_decision = { approve, cancel, is_approved, remove, target }

export { openai_lane_supervisor_decision }
