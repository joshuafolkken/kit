#!/usr/bin/env tsx
/**
 * Sync template workflow pins for Dependabot action-bump PRs.
 *
 * Usage:
 *   tsx scripts/sync/sync-dependabot-pins.ts 578 641          # sync + push each PR
 *   tsx scripts/sync/sync-dependabot-pins.ts --dry-run 578    # print plan; no side effects
 *
 * Dependabot bumps action SHA pins only in .github/workflows; the distributed
 * templates/workflows lag behind and the pin-parity guards fail. For each PR
 * this checks out the branch, runs the same sync as `josh swp`, and pushes the
 * template update. --dry-run performs no checkout/commit/push so it is safe to
 * run against an uncommitted working tree (e.g. during halfrun verification).
 */
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { git_command } from '#scripts/git/git-command'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { dependabot_pin_logic, type DependabotPinOps } from './dependabot-pin-logic'
import { workflow_pin_logic } from './workflow-pin-logic'

const TEMPLATE_WORKFLOWS_DIR = 'templates/workflows'
const HEAD_REF_QUERY: ReadonlyArray<string> = ['--json', 'headRefName', '--jq', '.headRefName']

async function fetch_pr_branch(pr: number): Promise<string> {
	return await git_gh_exec.exec_gh_command(['pr', 'view', String(pr), ...HEAD_REF_QUERY])
}

async function checkout_pr(pr: number): Promise<void> {
	await git_gh_exec.exec_gh_command(['pr', 'checkout', String(pr)])
}

async function checkout_branch(branch: string): Promise<void> {
	await git_command.checkout(branch)
}

async function stage_templates(): Promise<void> {
	await git_command.add_path(TEMPLATE_WORKFLOWS_DIR)
}

function log_line(message: string): void {
	console.info(message)
}

const real_ops: DependabotPinOps = {
	get_current_branch: git_command.branch,
	get_pr_branch: fetch_pr_branch,
	checkout_pr,
	checkout_branch,
	sync_pins: workflow_pin_logic.sync_pins,
	stage_templates,
	commit: git_command.commit,
	push: git_command.push,
	log: log_line,
}

function report_failure(error: unknown): never {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
}

async function main(): Promise<void> {
	try {
		const { values, positionals } = parseArgs({
			options: { 'dry-run': { type: 'boolean', default: false } },
			allowPositionals: true,
			strict: true,
		})

		const prs = dependabot_pin_logic.parse_pr_numbers(positionals)

		await dependabot_pin_logic.run_sync(prs, { is_dry_run: values['dry-run'] }, real_ops)
	} catch (error) {
		report_failure(error)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { real_ops }
