import type { PinDrift } from './workflow-pin-logic'

// Orchestration for `josh sync-dependabot-pins`: propagate a Dependabot action
// bump from .github/workflows into templates/workflows for one or more PRs.
// All git/gh side effects are injected via DependabotPinOps so the control flow
// (checkout order, drift-skip, dry-run no-op) is unit-testable without spawning.
const NO_PR_MESSAGE = 'No PR numbers supplied (e.g. `josh sdp 578 641`)'
const INVALID_PR_PREFIX = 'Invalid PR number: '
const DEPENDABOT_BRANCH_PREFIX = 'dependabot/'
const PR_NUMBER_PATTERN = /^[1-9]\d*$/u

interface DependabotPinOps {
	get_current_branch: () => Promise<string>
	get_pr_branch: (pr: number) => Promise<string>
	checkout_pr: (pr: number) => Promise<void>
	checkout_branch: (branch: string) => Promise<void>
	sync_pins: () => Array<PinDrift>
	stage_templates: () => Promise<void>
	commit: (message: string) => Promise<void>
	push: () => Promise<void>
	log: (message: string) => void
}

interface SyncOptions {
	is_dry_run: boolean
}

interface PrResult {
	pr: number
	synced_count: number
	is_committed: boolean
}

function build_commit_message(pr: number): string {
	return `Sync template workflow pins (Dependabot #${String(pr)})`
}

function parse_pr_number(token: string): number {
	if (!PR_NUMBER_PATTERN.test(token)) throw new Error(`${INVALID_PR_PREFIX}${token}`)

	const pr = Number(token)
	if (!Number.isSafeInteger(pr)) throw new Error(`${INVALID_PR_PREFIX}${token}`)

	return pr
}

function parse_pr_numbers(tokens: ReadonlyArray<string>): Array<number> {
	if (tokens.length === 0) throw new Error(NO_PR_MESSAGE)

	return tokens.map((token) => parse_pr_number(token))
}

async function commit_synced_pins(pr: number, ops: DependabotPinOps): Promise<void> {
	await ops.stage_templates()
	await ops.commit(build_commit_message(pr))
	await ops.push()
}

function skipped_result(pr: number): PrResult {
	return { pr, synced_count: 0, is_committed: false }
}

async function checkout_dependabot_pr(pr: number, ops: DependabotPinOps): Promise<boolean> {
	await ops.checkout_pr(pr)
	const branch = await ops.get_current_branch()

	if (branch.startsWith(DEPENDABOT_BRANCH_PREFIX)) return true

	ops.log(`#${String(pr)}: ${branch} is not a Dependabot branch — skipped`)

	return false
}

async function apply_pr(pr: number, ops: DependabotPinOps): Promise<PrResult> {
	if (!(await checkout_dependabot_pr(pr, ops))) return skipped_result(pr)

	const drifts = ops.sync_pins()

	if (drifts.length === 0) {
		ops.log(`#${String(pr)}: template pins already in sync — skipped`)

		return skipped_result(pr)
	}

	await commit_synced_pins(pr, ops)
	ops.log(`#${String(pr)}: synced ${String(drifts.length)} pin(s) and pushed`)

	return { pr, synced_count: drifts.length, is_committed: true }
}

async function plan_pr(pr: number, ops: DependabotPinOps): Promise<PrResult> {
	const branch = await ops.get_pr_branch(pr)

	ops.log(`#${String(pr)} (${branch}): would sync template pins and push if drifted [dry-run]`)

	return skipped_result(pr)
}

async function process_pr(
	pr: number,
	options: SyncOptions,
	ops: DependabotPinOps,
): Promise<PrResult> {
	if (options.is_dry_run) return await plan_pr(pr, ops)

	return await apply_pr(pr, ops)
}

async function run_sync(
	prs: ReadonlyArray<number>,
	options: SyncOptions,
	ops: DependabotPinOps,
): Promise<Array<PrResult>> {
	const start_branch = await ops.get_current_branch()
	const results: Array<PrResult> = []

	try {
		for (const pr of prs) {
			results.push(await process_pr(pr, options, ops))
		}
	} finally {
		if (!options.is_dry_run) await ops.checkout_branch(start_branch)
	}

	return results
}

const dependabot_pin_logic = {
	build_commit_message,
	parse_pr_numbers,
	run_sync,
}

export { dependabot_pin_logic }
export type { DependabotPinOps, PrResult, SyncOptions }
