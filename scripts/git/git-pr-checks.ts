import { git_gh_command } from './git-gh-command'
import { evaluate_pr_state, type PrEvaluation } from './git-pr-checks-eval'
import { parse_pr_state_snapshot, type PrStateSnapshot } from './git-pr-checks-parse'
import { package_name_schema } from './schemas'

const SECONDS_TO_MS = 1000
const CHECK_WAIT_INTERVAL_MS = 10_000
const DEFAULT_TIMEOUT_SECONDS = 180

function compute_max_attempts(timeout_seconds: number, interval_ms: number): number {
	return Math.ceil(timeout_seconds / (interval_ms / SECONDS_TO_MS))
}

const DEFAULT_MAX_ATTEMPTS = compute_max_attempts(DEFAULT_TIMEOUT_SECONDS, CHECK_WAIT_INTERVAL_MS)

function get_configured_max_attempts(): number {
	const environment_seconds = Number(process.env['JOSH_CI_TIMEOUT_SECONDS'])

	return Number.isFinite(environment_seconds) && environment_seconds > 0
		? compute_max_attempts(environment_seconds, CHECK_WAIT_INTERVAL_MS)
		: DEFAULT_MAX_ATTEMPTS
}

const CHECK_MAX_ATTEMPTS = get_configured_max_attempts()
const DEFAULT_STABLE_READS = 2

type PrStateFetcher = (branch_name: string) => Promise<PrStateSnapshot>

interface WaitForPrSuccessOptions {
	branch_name: string
	fetcher: PrStateFetcher
	interval_ms: number
	max_attempts: number
	required_stable_reads: number
}

function parse_repo_name_from_package(package_json_content: string): string {
	const result = package_name_schema.safeParse(JSON.parse(package_json_content))

	if (!result.success) {
		throw new Error('package.json name field is missing or not a non-empty string')
	}

	return result.data.name
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
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
		console.info(`Checking PR status… (${String(attempt + 1)}/${String(options.max_attempts)})`)
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
	wait_for_pr_success,
	compute_max_attempts,
	get_configured_max_attempts,
	DEFAULT_STABLE_READS,
	DEFAULT_MAX_ATTEMPTS,
}
export type { PrStateFetcher }
export { evaluate_pr_state } from './git-pr-checks-eval'
export type { PrEvaluation } from './git-pr-checks-eval'
export { parse_pr_state_snapshot } from './git-pr-checks-parse'
export type { RollupCheck, PrStateSnapshot } from './git-pr-checks-parse'
