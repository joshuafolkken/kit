import { pr_raw_schema, type RollupItemData } from './schemas'

const CHECK_STATUS_PASS = 'pass'
const CHECK_STATUS_PENDING = 'pending'
const CHECK_STATUS_FAIL = 'fail'
const CHECK_STATUS_MISSING = 'missing'

const KEY_TYPE_NAME = '__typename'
const KEY_STATE = 'state'
const KEY_STATUS = 'status'
const KEY_CONCLUSION = 'conclusion'
const KEY_NAME = 'name'
const KEY_CONTEXT = 'context'

interface RollupCheck {
	name: string
	status: string
}

interface PrStateSnapshot {
	rollup: Array<RollupCheck>
	merge_state_status: string | undefined
	review_decision: string | undefined
}

function read_string(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	if (trimmed.length === 0) return undefined

	return trimmed
}

function parse_status_context(item: RollupItemData): string {
	const state = read_string(item[KEY_STATE])?.toLowerCase()
	if (state === 'success') return CHECK_STATUS_PASS
	if (state === 'pending') return CHECK_STATUS_PENDING

	return CHECK_STATUS_FAIL
}

function parse_check_run(item: RollupItemData): string {
	const status = read_string(item[KEY_STATUS])?.toLowerCase()
	if (status !== 'completed') return CHECK_STATUS_PENDING
	const conclusion = read_string(item[KEY_CONCLUSION])?.toLowerCase()

	return conclusion === 'success' ? CHECK_STATUS_PASS : CHECK_STATUS_FAIL
}

function parse_rollup_status(item: RollupItemData): string {
	const type_name = read_string(item[KEY_TYPE_NAME])
	if (type_name === 'StatusContext') return parse_status_context(item)

	return parse_check_run(item)
}

function read_rollup_array(parsed: unknown): Array<RollupItemData> {
	const result = pr_raw_schema.safeParse(parsed)
	if (!result.success) return []

	return result.data.statusCheckRollup ?? []
}

function parse_json_safe(raw_json: string): unknown {
	try {
		return JSON.parse(raw_json)
	} catch {
		return undefined
	}
}

function parse_rollup_item(item: RollupItemData): RollupCheck | undefined {
	const name = read_string(item[KEY_NAME]) ?? read_string(item[KEY_CONTEXT])
	if (name === undefined) return undefined

	return { name, status: parse_rollup_status(item) }
}

function parse_rollup_checks(raw_json: string): Array<RollupCheck> {
	const parsed = parse_json_safe(raw_json)
	const rollup = read_rollup_array(parsed)
	const checks: Array<RollupCheck> = []

	for (const item of rollup) {
		const parsed_item = parse_rollup_item(item)
		if (parsed_item !== undefined) checks.push(parsed_item)
	}

	return checks
}

function parse_pr_state_snapshot(raw_json: string): PrStateSnapshot {
	const parsed = parse_json_safe(raw_json)
	const result = pr_raw_schema.safeParse(parsed)
	const data = result.success ? result.data : undefined

	return {
		rollup: parse_rollup_checks(raw_json),
		merge_state_status: read_string(data?.mergeStateStatus),
		review_decision: read_string(data?.reviewDecision),
	}
}

const git_pr_checks_parse = {
	parse_rollup_checks,
	parse_json_safe,
	read_string,
	parse_pr_state_snapshot,
}

export {
	git_pr_checks_parse,
	parse_rollup_checks,
	parse_json_safe,
	read_string,
	parse_pr_state_snapshot,
	CHECK_STATUS_PASS,
	CHECK_STATUS_PENDING,
	CHECK_STATUS_FAIL,
	CHECK_STATUS_MISSING,
}
export type { RollupCheck, PrStateSnapshot }
