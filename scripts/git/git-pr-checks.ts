import { git_gh_command } from './git-gh-command'
import { package_name_schema, pr_raw_schema, type RollupItemData } from './schemas'

// cspell:words coderabbit

const CHECK_STATUS_PASS = 'pass'
const CHECK_STATUS_PENDING = 'pending'
const CHECK_STATUS_FAIL = 'fail'
const CHECK_STATUS_MISSING = 'missing'
const CHECK_WAIT_INTERVAL_MS = 10_000
const CHECK_MAX_ATTEMPTS = 18
const DEFAULT_STABLE_READS = 2
const MERGE_STATE_CLEAN = 'CLEAN'
const REVIEW_CHANGES_REQUESTED = 'CHANGES_REQUESTED'

function parse_repo_name_from_package(package_json_content: string): string {
	const result = package_name_schema.safeParse(JSON.parse(package_json_content))

	if (!result.success) {
		throw new Error('package.json name field is missing or not a non-empty string')
	}

	return result.data.name
}

const REQUIRED_CHECKS = ['CodeRabbit', 'SonarQube']

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

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

type PrEvaluation = 'success' | 'pending' | 'failure'

interface PrStateSnapshot {
	rollup: Array<RollupCheck>
	merge_state_status: string | undefined
	review_decision: string | undefined
}

type PrStateFetcher = (branch_name: string) => Promise<PrStateSnapshot>

interface WaitForPrSuccessOptions {
	branch_name: string
	fetcher: PrStateFetcher
	interval_ms: number
	max_attempts: number
	required_stable_reads: number
}

function read_required_statuses(checks: ReadonlyArray<RollupCheck>): Array<string> {
	return REQUIRED_CHECKS.map((name) => {
		const match = checks.find((check) => check.name === name)

		return match?.status ?? CHECK_STATUS_MISSING
	})
}

function is_review_blocked(review_decision: string | undefined): boolean {
	return review_decision === REVIEW_CHANGES_REQUESTED
}

function evaluate_failure_state(input: {
	review_decision: string | undefined
	statuses: ReadonlyArray<string>
}): PrEvaluation | undefined {
	if (is_review_blocked(input.review_decision)) return 'failure'
	if (input.statuses.includes(CHECK_STATUS_FAIL)) return 'failure'

	return undefined
}

function is_merge_state_clean(merge_state_status: string | undefined): boolean {
	return merge_state_status === MERGE_STATE_CLEAN
}

function are_required_all_passing(statuses: ReadonlyArray<string>): boolean {
	return statuses.every((status) => status === CHECK_STATUS_PASS)
}

function evaluate_pr_state(snapshot: PrStateSnapshot): PrEvaluation {
	const statuses = read_required_statuses(snapshot.rollup)
	const failure = evaluate_failure_state({
		review_decision: snapshot.review_decision,
		statuses,
	})

	if (failure !== undefined) return failure

	if (is_merge_state_clean(snapshot.merge_state_status) && are_required_all_passing(statuses)) {
		return 'success'
	}

	return 'pending'
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

function advance_stable_count(previous: number, state: PrEvaluation): number {
	return state === 'success' ? previous + 1 : 0
}

function classify_poll_result(input: {
	snapshot: PrStateSnapshot
	stable_count: number
	required_stable_reads: number
}): { is_done: boolean; next_stable_count: number } {
	const state = evaluate_pr_state(input.snapshot)

	if (state === 'failure') {
		throw new Error('PR checks failed (required check failed or review requested changes).')
	}

	const next_stable_count = advance_stable_count(input.stable_count, state)

	return {
		is_done: next_stable_count >= input.required_stable_reads,
		next_stable_count,
	}
}

async function attempt_pr_success_poll(input: {
	options: WaitForPrSuccessOptions
	stable_count: number
	attempt: number
}): Promise<{ snapshot?: PrStateSnapshot; next_stable_count: number }> {
	const snapshot = await input.options.fetcher(input.options.branch_name)
	const classification = classify_poll_result({
		snapshot,
		stable_count: input.stable_count,
		required_stable_reads: input.options.required_stable_reads,
	})

	if (classification.is_done) return { snapshot, next_stable_count: 0 }

	if (input.attempt < input.options.max_attempts - 1) {
		await sleep(input.options.interval_ms)
	}

	return { next_stable_count: classification.next_stable_count }
}

async function wait_for_pr_success(options: WaitForPrSuccessOptions): Promise<PrStateSnapshot> {
	let stable_count = 0

	for (let attempt = 0; attempt < options.max_attempts; attempt += 1) {
		const result = await attempt_pr_success_poll({ options, stable_count, attempt })

		if (result.snapshot !== undefined) return result.snapshot
		stable_count = result.next_stable_count
	}

	throw new Error('Timed out while waiting for PR checks to complete.')
}

async function default_fetch_pr_state(branch_name: string): Promise<PrStateSnapshot> {
	const raw_json = await git_gh_command.pr_get_state_snapshot(branch_name)

	return parse_pr_state_snapshot(raw_json)
}

async function wait_for_pr_success_default(branch_name: string): Promise<PrStateSnapshot> {
	return await wait_for_pr_success({
		branch_name,
		fetcher: default_fetch_pr_state,
		interval_ms: CHECK_WAIT_INTERVAL_MS,
		max_attempts: CHECK_MAX_ATTEMPTS,
		required_stable_reads: DEFAULT_STABLE_READS,
	})
}

const git_pr_checks = {
	wait_for_pr_success: wait_for_pr_success_default,
}

export {
	git_pr_checks,
	parse_repo_name_from_package,
	evaluate_pr_state,
	parse_pr_state_snapshot,
	wait_for_pr_success,
	DEFAULT_STABLE_READS,
}
export type { RollupCheck, PrEvaluation, PrStateSnapshot, PrStateFetcher }
