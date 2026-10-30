import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { lane_state } from '#scripts/lane/lane-state'
import { run_hold } from '#scripts/run/hold/run-hold'
import { describe, expect, it } from 'vitest'
import { josh_harness, type JoshEnvironment } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const KINDS = ['kit', 'consumer', 'lane'] as const
const ISSUE = '5410'
const environment = josh_harness_fixture.open_environments(KINDS)
const { SCENARIO_TIMEOUT_MS } = josh_harness_fixture
const EXECUTABLE_MODE = 0o755

function command_environment(opened: JoshEnvironment): Record<string, string | undefined> {
	const bin = path.join(opened.workspace, 'offline-bin')

	mkdirSync(bin, { recursive: true })
	writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: EXECUTABLE_MODE })

	return {
		...josh_harness.CHILD_ENVIRONMENT,
		PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
		JOSH_NOTIFY: 'off',
	}
}

async function run_offline(opened: JoshEnvironment, args: ReadonlyArray<string>): Promise<string> {
	const result = await josh_harness.run_command(
		opened.launcher.executable,
		[...opened.launcher.leading_arguments, ...args],
		{ cwd: opened.root, env: command_environment(opened), timeout_ms: SCENARIO_TIMEOUT_MS },
	)

	expect(result.exit_code, result.stderr).toBe(0)

	return result.stdout
}

async function directories(opened: JoshEnvironment): Promise<Array<string>> {
	const result = await josh_harness.run_command(
		'git',
		['rev-parse', '--absolute-git-dir', '--git-common-dir'],
		{ cwd: opened.root, env: josh_harness.CHILD_ENVIRONMENT, timeout_ms: SCENARIO_TIMEOUT_MS },
	)

	return result.stdout
		.trim()
		.split('\n')
		.map((part) => path.resolve(opened.root, part))
}

describe('josh harness — human-review stops retain a lane', () => {
	it.each(KINDS)(
		'records the stop locally in %s without releasing its hold',
		async (kind) => {
			const opened = environment(kind)
			const [worktree, common] = await directories(opened)

			if (worktree === undefined || common === undefined) throw new Error('git directories unread')
			const hold = run_hold.hold_path(worktree)

			run_hold.create_hold(hold, ISSUE)
			await run_offline(opened, ['test:e2e'])
			expect(await run_offline(opened, ['run:hold', ISSUE, '--human-review-stop'])).toBe('hold')
			expect(await lane_state.read_state(ISSUE, common)).toMatchObject({ state: 'human-review' })
			expect(run_hold.read_hold(hold)).toMatchObject({
				kind: 'held',
				hold: { is_halfrun_stop: true },
			})
		},
		SCENARIO_TIMEOUT_MS,
	)
})
