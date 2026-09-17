import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OBSERVATION_LEDGER_PATH } from '#scripts/observations/observation-ledger'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_command } from './git-command'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'

// joshuafolkken/kit#1756 put an exclusion into what `pnpm josh git` stages, and an exclusion is a
// **pathspec** — a spelling git either accepts or silently reads as something else. Mocking the
// argument list would assert that this repository passes the strings it means to pass and say
// nothing about what git does with them, and the failure mode is the expensive one: a pathspec list
// made only of exclusions matches nothing at all, so a wrong spelling stages an empty commit on
// every run rather than erroring. So this suite drives **real git**, the same way
// `lane-change-base.test.ts` does, and asserts the index afterwards.

const { git } = git_fixture_workspace
const OTHER_FILE = 'README.md'
const LEDGER_FIRST_LINE = '- k:one | d1 | 2026-09-11 | scripts/x.ts | The first sighting\n'
const LEDGER_SECOND_LINE = '- k:two | d1 | 2026-09-11 | scripts/y.ts | The second sighting\n'

// Held on an object rather than in a `let`: the fixture is opened inside `beforeEach`, and assigning
// a module-level binding from inside a function is what `unicorn/no-top-level-assignment-in-function`
// refuses.
const state: { fixture: FixtureWorkspace } = {
	fixture: { workspace: '', previous_cwd: '', restore_environment: undefined },
}

function write_file(relative_path: string, body: string): void {
	const target = path.join(state.fixture.workspace, relative_path)

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(target, body, 'utf8')
}

async function build_repository(): Promise<void> {
	await git(state.fixture.workspace, ['init', git_fixture_workspace.MAIN_BRANCH])
	write_file(OTHER_FILE, 'first\n')
	write_file(OBSERVATION_LEDGER_PATH, LEDGER_FIRST_LINE)
	await git(state.fixture.workspace, ['add', '-A'])
	await git(state.fixture.workspace, ['commit', '-m', 'initial'])
}

function modify_both_files(): void {
	write_file(OTHER_FILE, 'second\n')
	write_file(OBSERVATION_LEDGER_PATH, `${LEDGER_FIRST_LINE}${LEDGER_SECOND_LINE}`)
}

// git orders `--name-only` by path bytes of its own accord, so the expectations below are written in
// that order rather than sorted here — a sort in the reader would hide a change in what git returns.
async function staged_paths(): Promise<ReadonlyArray<string>> {
	const output = await git(state.fixture.workspace, ['diff', '--cached', '--name-only'])

	return output.split('\n').filter((line) => line.length > 0)
}

describe('git_command.add_tracked — the pathspec git actually receives', () => {
	beforeEach(async () => {
		state.fixture = git_fixture_workspace.open_workspace('kit-ledger-staging-')
		await build_repository()
		process.chdir(state.fixture.workspace)
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(state.fixture)
	})

	it('stages every other tracked change while leaving the ledger unstaged', async () => {
		modify_both_files()

		await git_command.add_tracked([OBSERVATION_LEDGER_PATH])

		expect(await staged_paths()).toEqual([OTHER_FILE])
	})

	// The other half of the same spelling: with nothing excluded it has to stage exactly what the bare
	// `git add -u` it replaced staged, or the exclusion would have been bought by narrowing every
	// commit this package makes.
	it('stages everything tracked when no path is excluded', async () => {
		modify_both_files()

		await git_command.add_tracked([])

		expect(await staged_paths()).toEqual([OTHER_FILE, OBSERVATION_LEDGER_PATH])
	})

	// `:/` is anchored to the repository root rather than to the process's working directory, which is
	// what makes it a drop-in for a bare `git add -u`. A plain `.` here would stage only what sits
	// under `docs/`, and every hook and script that runs git from a subdirectory would commit less
	// than it used to without saying so.
	it('stages from the repository root even when run inside a subdirectory', async () => {
		modify_both_files()
		process.chdir(path.join(state.fixture.workspace, path.dirname(OBSERVATION_LEDGER_PATH)))

		await git_command.add_tracked([OBSERVATION_LEDGER_PATH])

		expect(await staged_paths()).toEqual([OTHER_FILE])
	})
})
