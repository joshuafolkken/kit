import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'
import { describe, expect, it } from 'vitest'
import { josh_harness, type JoshEnvironment } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const KINDS = ['kit', 'consumer', 'lane'] as const
const environment = josh_harness_fixture.open_environments(KINDS)
const { SCENARIO_TIMEOUT_MS } = josh_harness_fixture
const CALLING_REPO = 'joshuafolkken/app-kit'
const EXECUTABLE_MODE = 0o755
const FINDER = '307'
const CALLS_FILE = 'calls.jsonl'
const GH_SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv[2] === '--version') { console.log('gh version 2.0.0'); process.exit(0) }
fs.appendFileSync(process.env.JOSH_INTERRUPT_CALLS, JSON.stringify(process.argv.slice(2)) + '\n')
console.error('offline comment refusal')
process.exit(1)
`

function setup_transport(opened: JoshEnvironment): Record<string, string | undefined> {
	const bin = path.join(opened.workspace, 'offline-bin')

	mkdirSync(bin, { recursive: true })
	writeFileSync(path.join(bin, 'gh'), GH_SCRIPT, { mode: EXECUTABLE_MODE })
	writeFileSync(path.join(opened.workspace, 'body.md'), 'Upstream defect reproduction.')

	return {
		...josh_harness.CHILD_ENVIRONMENT,
		PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
		GH_REPO: CALLING_REPO,
		JOSH_NOTIFY: 'off',
		JOSH_INTERRUPT_CALLS: path.join(opened.workspace, CALLS_FILE),
	}
}

async function interrupt(opened: JoshEnvironment): Promise<string> {
	await git_fixture_workspace.git(opened.root, [
		'config',
		'--local',
		'remote.origin.url',
		`https://github.com/${CALLING_REPO}`,
	])
	const result = await josh_harness.run_command(
		opened.launcher.executable,
		[
			...opened.launcher.leading_arguments,
			'upstream:interrupt',
			FINDER,
			'Upstream defect',
			'--repo',
			'sveltejs/kit',
			'--body-file',
			path.join(opened.workspace, 'body.md'),
		],
		{ cwd: opened.root, env: setup_transport(opened), timeout_ms: SCENARIO_TIMEOUT_MS },
	)

	expect(result.is_timed_out).toBe(false)
	expect(result.exit_code, result.stdout + result.stderr).toBe(1)

	return result.stderr
}

describe('josh harness — upstream interrupt finder repository', () => {
	it.each(KINDS)(
		'keeps the comment and recovery scoped to the caller in %s',
		async (kind) => {
			const opened = environment(kind)
			const stderr = await interrupt(opened)
			const calls = readFileSync(path.join(opened.workspace, CALLS_FILE), 'utf8')

			expect(calls).toContain(`repos/${CALLING_REPO}/issues/${FINDER}/comments`)
			expect(calls).not.toContain('repos/joshuafolkken/kit/')
			expect(calls).not.toContain('repos/sveltejs/kit/')
			expect(stderr).toContain(`GH_REPO=${CALLING_REPO} pnpm josh issue:comment ${FINDER}`)
		},
		SCENARIO_TIMEOUT_MS,
	)
})
