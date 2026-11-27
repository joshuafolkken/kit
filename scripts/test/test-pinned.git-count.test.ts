import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_utilities } from '#scripts/git/constants'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'

// joshuafolkken/kit#9014: one `test_pinned.run` spawned 59 git processes, and that fixed cost —
// not the fixture — was most of the four test-pinned files' time. The cap pins the reduced count, so a
// change that adds a spawn to the run's path turns this red. A shim named through `JOSH_GIT_BINARY`
// counts every spawn path (async, sync, and the common-directory read) and hands each call on to the
// binary that was in place, so the unit suite's network guard still sees it.

const RUN_TIMEOUT = 120_000
const GIT_BINARY_KEY = 'JOSH_GIT_BINARY'
const EXECUTABLE = 0o755
// The run's spawns on the fixture after #9014 (measured 59 before it).
const MAX_GIT_SPAWNS = 51

const create_directory = temporary_directory()
const fixture: { workspace?: FixtureWorkspace } = {}

// Answers the log the shim appends one line per git call to.
function install_shim(): string {
	const directory = create_directory('josh-git-count-')
	const log = path.join(directory, 'calls.log')
	const shim = path.join(directory, 'git')
	const next = git_utilities.get_git_command_for_spawn()

	writeFileSync(log, '')
	writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${next}' "$@"\n`)
	chmodSync(shim, EXECUTABLE)
	vi.stubEnv(GIT_BINARY_KEY, shim)

	return log
}

function calls(log: string): Array<string> {
	return readFileSync(log, 'utf8')
		.split('\n')
		.filter((line) => line !== '')
}

beforeEach(() => {
	fixture.workspace = git_fixture_workspace.open_workspace('test-pinned-git-count-')
	process.chdir(fixture.workspace.workspace)
})

afterEach(async () => {
	vi.unstubAllEnvs()

	if (fixture.workspace !== undefined) {
		await git_fixture_workspace.close_workspace(fixture.workspace)
	}
})

it(
	'spawns no more git processes per run than the #9014 cap',
	async () => {
		await test_pinned_fixture.build_change_branch()
		const log = install_shim()

		await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

		const spawned = calls(log)

		console.info(`git spawns per run: ${String(spawned.length)}\n${spawned.join('\n')}`)
		expect(spawned.length).toBeLessThanOrEqual(MAX_GIT_SPAWNS)
	},
	RUN_TIMEOUT,
)
