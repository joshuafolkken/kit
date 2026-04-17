#!/usr/bin/env tsx
/**
 * Check for drift between files synced from joshuafolkken/tasks and our local copies.
 *
 * Usage:
 *   tsx scripts/check-upstream-drift.ts
 *
 * Exits with code 1 if any tracked file diverges from the pinned upstream SHA.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const TASKS_UPSTREAM_SHA = 'e3df052ec3fe08eba67f2d98fa33eef0a5b75bf5'
const TASKS_REPO = 'joshuafolkken/tasks'
const RAW_HOST = 'https://raw.githubusercontent.com'
const HTTP_NOT_FOUND = 404

type DriftStatus = 'match' | 'drifted' | 'missing_local' | 'missing_upstream'

interface DriftItem {
	path: string
	status: Exclude<DriftStatus, 'match'>
}

const SYNCED_FILES: ReadonlyArray<string> = [
	'prompts/collaboration-workflow.md',
	'prompts/refactoring.md',
	'prompts/testing-guide.md',
	'CLAUDE.md',
	'AGENTS.md',
	'GEMINI.md',
	'.claude/settings.json',
	'.claude/remote-setup.sh',
	'.mcp.json',
	'pnpm-workspace.yaml',
	// playwright.config.ts intentionally diverges — tasks version depends on e2e helpers we don't mirror.
	// See prompts/upstream-sync.md.
	'scripts/common.ts',
	'scripts/bump-version.ts',
	'scripts/check-commit-message.ts',
	'scripts/prevent-main-commit.ts',
	'scripts/git-workflow.ts',
	'scripts/git-followup-workflow.ts',
	'scripts/issue-prep.ts',
	'scripts/latest-update.ts',
	'scripts/overrides-check.ts',
	'scripts/prep.ts',
	'scripts/save-playwright-auth-storage.ts',
	'scripts/telegram-test.ts',
	'scripts/issue/issue-logic.ts',
	'scripts/issue/issue-logic.test.ts',
	'scripts/overrides/overrides-logic.ts',
	'scripts/overrides/overrides-logic.test.ts',
	'scripts/git/animation-helpers.ts',
	'scripts/git/constants.ts',
	'scripts/git/git-animation.ts',
	'scripts/git/git-branch.ts',
	'scripts/git/git-command.ts',
	'scripts/git/git-commit.ts',
	'scripts/git/git-conflict.ts',
	'scripts/git/git-countdown.ts',
	'scripts/git/git-error.ts',
	'scripts/git/git-gh-command.ts',
	'scripts/git/git-gh-command.spec.ts',
	'scripts/git/git-issue.ts',
	'scripts/git/git-notify.ts',
	'scripts/git/git-pr-checks-watch.ts',
	'scripts/git/git-pr-checks.ts',
	'scripts/git/git-pr-error.ts',
	'scripts/git/git-pr-followup.spec.ts',
	'scripts/git/git-pr-followup.test.ts',
	'scripts/git/git-pr-followup.ts',
	'scripts/git/git-pr-messages.ts',
	'scripts/git/git-pr.ts',
	'scripts/git/git-prompt-display.ts',
	'scripts/git/git-prompt.ts',
	'scripts/git/git-push.ts',
	'scripts/git/git-staging.spec.ts',
	'scripts/git/git-staging.ts',
	'scripts/git/git-status.ts',
	'scripts/git/telegram-notify.spec.ts',
	'scripts/git/telegram-notify.ts',
]

function build_raw_url(sha: string, file_path: string): string {
	const encoded = file_path
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')

	return `${RAW_HOST}/${TASKS_REPO}/${sha}/${encoded}`
}

function classify(local: string | undefined, upstream: string | undefined): DriftStatus {
	if (local === undefined) return 'missing_local'
	if (upstream === undefined) return 'missing_upstream'
	if (local === upstream) return 'match'

	return 'drifted'
}

function format_report(items: ReadonlyArray<DriftItem>): string {
	if (items.length === 0) return '✔ No drift detected.'

	const lines = items.map((item) => `  [${item.status}] ${item.path}`)
	const count = String(items.length)

	return `✖ Drift detected (${count} file(s)):\n${lines.join('\n')}`
}

async function fetch_upstream(file_path: string): Promise<string | undefined> {
	const response = await fetch(build_raw_url(TASKS_UPSTREAM_SHA, file_path))

	if (response.status === HTTP_NOT_FOUND) return undefined
	if (!response.ok) throw new Error(`Failed to fetch ${file_path}: ${String(response.status)}`)

	return await response.text()
}

async function read_local(file_path: string): Promise<string | undefined> {
	try {
		return await readFile(path.resolve(process.cwd(), file_path), 'utf8')
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	}
}

async function check_path(file_path: string): Promise<DriftItem | undefined> {
	const [local, upstream] = await Promise.all([read_local(file_path), fetch_upstream(file_path)])
	const status = classify(local, upstream)

	if (status === 'match') return undefined

	return { path: file_path, status }
}

async function main(): Promise<void> {
	const results = await Promise.all(
		SYNCED_FILES.map(async (file_path) => await check_path(file_path)),
	)
	const drifted = results.filter((item): item is DriftItem => item !== undefined)

	console.info(format_report(drifted))

	if (drifted.length > 0) process.exit(1)
}

const is_main_module = import.meta.url === `file://${process.argv[1] ?? ''}`

if (is_main_module) {
	try {
		await main()
	} catch (error) {
		console.error(error)
		process.exit(1)
	}
}

const upstream_drift = {
	TASKS_UPSTREAM_SHA,
	TASKS_REPO,
	SYNCED_FILES,
	build_raw_url,
	classify,
	format_report,
}

export type { DriftItem, DriftStatus }
export { upstream_drift }
