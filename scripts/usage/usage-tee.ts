import { text } from 'node:stream/consumers'
import { atomic_write } from '#scripts/lib/atomic-write'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { usage_state_path } from './usage-state-path'

const MAX_PERCENTAGE = 100
const PRIVATE_FILE_MODE = 0o600
const window_schema = z.object({
	used_percentage: z.number().min(0).max(MAX_PERCENTAGE),
	resets_at: z.number().nonnegative(),
})
const payload_schema = z.object({
	rate_limits: z.object({
		five_hour: window_schema.optional(),
		seven_day: window_schema.optional(),
	}),
})

function record(raw: string): void {
	const payload = json_value.parse_with(raw, payload_schema)
	if (payload === undefined) return
	// Missing windows are explicitly unknown, never a stale value with a fresh timestamp.
	const state = {
		// JSON null explicitly represents an unknown window in the shared record.
		// eslint-disable-next-line unicorn/no-null
		five_hour: payload.rate_limits.five_hour ?? null,
		// eslint-disable-next-line unicorn/no-null
		seven_day: payload.rate_limits.seven_day ?? null,
		at: new Date().toISOString(),
	}

	atomic_write.replace_file(usage_state_path.claude(), JSON.stringify(state), {
		mode: PRIVATE_FILE_MODE,
	})
}

async function run(): Promise<void> {
	try {
		if (!process.stdin.isTTY) record(await text(process.stdin))
	} catch {
		// A status line must remain silent even when stdin or the state directory is unavailable.
	}
}

const usage_tee = { run }

export { usage_tee }
