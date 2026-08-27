import { pr_raw_schema, type RollupItemData } from './schemas'

const CHECK_STATUS_PASS = 'pass'
const CHECK_STATUS_PENDING = 'pending'
const CHECK_STATUS_FAIL = 'fail'
const CHECK_STATUS_MISSING = 'missing'

// GitHub reports a job whose `if:` condition was false as COMPLETED with conclusion `skipped`, and
// counts it as satisfied for branch protection — PR #792 reached CLEAN while three such jobs sat in
// its rollup. Recording them as `fail` therefore disagreed with GitHub itself, and it disabled the
// kit#753 escape hatch: `is_unstable_only_from_coderabbit` opens the gate only when every
// non-passing check is CodeRabbit's, so kit's own conditional jobs (`auto-merge`, `E2E`,
// `Notify Auto Tag`) kept a slow review blocking the merge until the wait loop timed out. The bug
// was invisible on fast reviews, where CLEAN short-circuits the predicate — it could only surface on
// the exact path kit#753 exists to protect.
//
// `neutral` is here for the same reason `skipped` is, and joshuafolkken/kit#990 is what made leaving
// it out untenable. GitHub's own rollup counts a neutral conclusion as satisfied, so such a pull
// request reports CLEAN and merges in the UI — reading it as `fail` disagreed with GitHub exactly as
// `skipped` did. Until kit#990 that disagreement was survivable, because a non-required failure only
// left the state pending; now it ends the wait outright, so a bot that emits `neutral` to say it has
// nothing to report would kill a `followup` on a pull request GitHub considers mergeable.
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

// `EXPECTED` is GitHub's state for a required status context that has not been posted yet, so it is
// a check still to come rather than one that failed. Reading it as `fail` only delayed the merge
// until joshuafolkken/kit#990; it would now end the wait on the first poll of a run that is still
// legitimately progressing — the premature red exit kit#851 was filed to remove.
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
