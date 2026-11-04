import { readFile } from 'node:fs/promises'
import { json_value } from '#scripts/lib/json-value'
import { time_instant } from '#scripts/time-runtime/time-instant'
import { usage_state_path } from '#scripts/usage/usage-state-path'
import { z } from 'zod'
import { run_board_quota_read, type QuotaReading, type QuotaWindow } from './run-board-quota-read'

const MS_PER_SECOND = 1000
const MAX_PERCENTAGE = 100
const WINDOW = z.object({
	used_percentage: z.number().min(0).max(MAX_PERCENTAGE),
	resets_at: z.number().nonnegative(),
})
const RECORD = z.object({
	five_hour: WINDOW.nullable(),
	seven_day: WINDOW.nullable(),
	at: z.string(),
})

function window_of(minutes: number, window: z.infer<typeof WINDOW> | null): Array<QuotaWindow> {
	if (window === null) return []

	return [
		{ minutes, used_percent: window.used_percentage, resets_ms: window.resets_at * MS_PER_SECOND },
	]
}

function parse(text: string): QuotaReading | undefined {
	const record = json_value.parse_with(text, RECORD)
	const taken_ms = time_instant.parse_instant(record?.at)

	if (record === undefined || taken_ms === undefined) return undefined

	return {
		windows: [
			...window_of(run_board_quota_read.FIVE_HOURS_MINUTES, record.five_hour),
			...window_of(run_board_quota_read.SEVEN_DAYS_MINUTES, record.seven_day),
		],
		taken_ms,
	}
}

async function read(): Promise<QuotaReading | undefined> {
	try {
		return parse(await readFile(usage_state_path.claude(), 'utf8'))
	} catch {
		return undefined
	}
}

function observed_at(reading: QuotaReading | undefined): number {
	return reading?.taken_ms ?? -1
}

function newest(
	log: QuotaReading | undefined,
	status: QuotaReading | undefined,
): QuotaReading | undefined {
	if (status === undefined) return log
	if (log !== undefined && observed_at(log) >= observed_at(status)) return log

	return { ...status, per_task: log?.per_task }
}

const run_board_quota_status = { newest, parse, read }

export { run_board_quota_status }
