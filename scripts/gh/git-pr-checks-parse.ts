import { pr_raw_schema, type RollupItemData } from '#scripts/git/git-schemas'
import { json_value } from '#scripts/lib/json-value'
import type { z } from 'zod'

const CHECK_STATUS_PASS = 'pass'
const CHECK_STATUS_PENDING = 'pending'
const CHECK_STATUS_FAIL = 'fail'
const CHECK_STATUS_MISSING = 'missing'

// GitHub reports a job whose `if:` condition was false as COMPLETED with conclusion `skipped`, and
// counts it as satisfied for branch protection — a pull request reaches CLEAN with such jobs in its
// rollup. Recording them as `fail` would disagree with GitHub itself, and it would disable the
// CodeRabbit non-blocking exemption: `is_unstable_only_from_optional` opens the gate only when
// every non-passing check is CodeRabbit's or an optional one still running, so kit's own conditional jobs (`auto-merge`, `E2E`,
// `Notify Auto Tag`) would keep a slow review blocking the merge until the wait loop timed out. That
// is invisible on fast reviews, where CLEAN short-circuits the predicate — it surfaces only on the
// exact path the exemption exists to protect.
//
// `neutral` is here for the same reason `skipped` is. GitHub's own rollup counts a neutral
// conclusion as satisfied, so such a pull request reports CLEAN and merges in the UI — reading it as
// `fail` would disagree with GitHub exactly as `skipped` would. Because a non-required failure ends
// the wait outright, a bot that emits `neutral` to say it has nothing to report would kill a
// `followup` on a pull request GitHub considers mergeable.
// `action_required` and `stale` stay out on purpose: GitHub does not count either as satisfied, and
// a wrongly-blocked run costs one re-run of `followup` while a wrongly-passed one ships code no gate
// ever cleared.
const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral'])

const KEY_TYPE_NAME = '__typename'
const KEY_STATE = 'state'
const KEY_STATUS = 'status'
const KEY_CONCLUSION = 'conclusion'
const KEY_NAME = 'name'
const KEY_CONTEXT = 'context'
const KEY_DESCRIPTION = 'description'

interface RollupCheck {
	name: string
	status: string
	// A status context's own words — CodeRabbit says `Review rate limited` under a `success` state
	// (joshuafolkken/kit#3770). Absent where the check carries none.
	description?: string
}

interface PrStateSnapshot {
	rollup: Array<RollupCheck>
	merge_state_status: string | undefined
	review_decision: string | undefined
	// The commit `rollup` was read from — the head a merge has to name so that it lands what passed and
	// nothing pushed since (#4036). Absent where the snapshot carried none.
	head_sha?: string
	// The base branch's required status check contexts (joshuafolkken/kit#4351). Absent where the
	// branch requires none or they could not be read, which keeps the merge gate waiting for `CLEAN`.
	required_contexts?: Array<string>
}

function read_string(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	if (trimmed.length === 0) return undefined

	return trimmed
}

// `EXPECTED` is GitHub's state for a required status context that has not been posted yet, so it is
// a check still to come rather than one that failed. Reading it as `fail` would end the wait on the
// first poll of a run that is still legitimately progressing — a premature red exit.
const PENDING_STATUS_STATES = new Set(['pending', 'expected'])

function parse_status_context(item: RollupItemData): string {
	const state = read_string(item[KEY_STATE])?.toLowerCase()
	if (state === 'success') return CHECK_STATUS_PASS
	if (state !== undefined && PENDING_STATUS_STATES.has(state)) return CHECK_STATUS_PENDING

	return CHECK_STATUS_FAIL
}

function is_passing_conclusion(item: RollupItemData): boolean {
	const conclusion = read_string(item[KEY_CONCLUSION])?.toLowerCase()

	return conclusion !== undefined && PASSING_CONCLUSIONS.has(conclusion)
}

function parse_check_run(item: RollupItemData): string {
	const status = read_string(item[KEY_STATUS])?.toLowerCase()
	if (status !== 'completed') return CHECK_STATUS_PENDING

	return is_passing_conclusion(item) ? CHECK_STATUS_PASS : CHECK_STATUS_FAIL
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

function parse_rollup_item(item: RollupItemData): RollupCheck | undefined {
	const name = read_string(item[KEY_NAME]) ?? read_string(item[KEY_CONTEXT])
	if (name === undefined) return undefined

	const check = { name, status: parse_rollup_status(item) }
	const description = read_string(item[KEY_DESCRIPTION])

	return description === undefined ? check : { ...check, description }
}

function parse_rollup_checks(raw_json: string): Array<RollupCheck> {
	const parsed = json_value.parse_or_undefined(raw_json)
	const rollup = read_rollup_array(parsed)
	const checks: Array<RollupCheck> = []

	for (const item of rollup) {
		const parsed_item = parse_rollup_item(item)
		if (parsed_item !== undefined) checks.push(parsed_item)
	}

	return checks
}

function with_head_sha(snapshot: PrStateSnapshot, head_sha: string | undefined): PrStateSnapshot {
	return head_sha === undefined ? snapshot : { ...snapshot, head_sha }
}

function with_required_contexts(
	snapshot: PrStateSnapshot,
	required_contexts: Array<string> | undefined,
): PrStateSnapshot {
	if (required_contexts === undefined || required_contexts.length === 0) return snapshot

	return { ...snapshot, required_contexts }
}

type PrRawData = Partial<z.infer<typeof pr_raw_schema>>

function read_pr_raw_data(raw_json: string): PrRawData {
	const result = pr_raw_schema.safeParse(json_value.parse_or_undefined(raw_json))

	return result.success ? result.data : {}
}

function parse_pr_state_snapshot(raw_json: string): PrStateSnapshot {
	const data = read_pr_raw_data(raw_json)
	const snapshot = {
		rollup: parse_rollup_checks(raw_json),
		merge_state_status: read_string(data.mergeStateStatus),
		review_decision: read_string(data.reviewDecision),
	}

	return with_required_contexts(
		with_head_sha(snapshot, read_string(data.headRefOid)),
		data.requiredContexts,
	)
}

export {
	parse_rollup_checks,
	read_string,
	parse_pr_state_snapshot,
	CHECK_STATUS_PASS,
	CHECK_STATUS_PENDING,
	CHECK_STATUS_FAIL,
	CHECK_STATUS_MISSING,
}
export type { RollupCheck, PrStateSnapshot }
