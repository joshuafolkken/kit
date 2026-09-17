import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { git_location_environment } from './git-location-environment'

// The scaffolding a test needs to drive **real git** in a throwaway repository
// (joshuafolkken/kit#1533).
//
// Two suites need it — `lane-change-base.test.ts` builds a lane topology, `rename-changed-paths.test.ts`
// builds a branch that renames a file away — and neither can use a mocked git, because what each one
// asserts is a property of git itself rather than of an argument list this repository assembles.
//
// **It is one module rather than one copy per suite because this scaffolding has already had to be
// hardened once.** joshuafolkken/kit#1530 found these fixtures committing into the repository the
// suite was running in: under a git hook, `GIT_DIR` and `GIT_INDEX_FILE` beat `cwd` outright, and
// `git config user.email` wrote the fixture's identity into a `--local` config that every linked work
// tree shares. Both halves of that fix live below. A second copy would take the next such hardening
// in one place and silently keep the old behavior in the other — the clone `CLAUDE.md` prohibits.

// `restore_environment` is declared as "present, possibly undefined" rather than optional:
// `exactOptionalPropertyTypes` is on, so an optional property cannot be *assigned* `undefined`, and
// every suite here starts from a literal that has not opened a workspace yet.
interface FixtureWorkspace {
	workspace: string
	previous_cwd: string
	restore_environment: (() => void) | undefined
}

const MAIN_BRANCH = '--initial-branch=main'

// The name commits are authored under, exported because a suite asserts it: proving the identity
// reached the commit is half of proving it was never written into a config file.
const AUTHOR_NAME = 'Kit Fixture'

// **The identity rides on `-c` rather than being written with `git config`** (joshuafolkken/kit#1530).
// A `--local` write outlives the test and is shared by every work tree of the repository it lands in;
// an option is scoped to the one command.
const IDENTITY_OPTIONS: ReadonlyArray<string> = [
	'-c',
	'user.email=fixture@example.test',
	'-c',
	`user.name=${AUTHOR_NAME}`,
	'-c',
	'commit.gpgsign=false',
]

// **The environment is cleared rather than inherited** (joshuafolkken/kit#1530). Run from a git hook,
// this process holds `GIT_DIR` and `GIT_INDEX_FILE` pointing at the repository being pushed, and both
// beat `cwd` — so every command here would act on that repository instead of on the fixture.
async function git(cwd: string, arguments_: ReadonlyArray<string>): Promise<string> {
	const { stdout } = await execa('git', [...IDENTITY_OPTIONS, ...arguments_], {
		cwd,
		env: git_location_environment.location_free_environment(),
		extendEnv: true,
	})

	return stdout.trimEnd()
}

// Cleared for this process too, not only for the children `git` spawns: a suite's assertions drive
// `git_command`, which spawns git with no environment of its own and so inherits this one.
function open_workspace(prefix: string): FixtureWorkspace {
	return {
		restore_environment: git_location_environment.clear_git_location_variables(),
		previous_cwd: process.cwd(),
		workspace: mkdtempSync(path.join(tmpdir(), prefix)),
	}
}

async function close_workspace(fixture: FixtureWorkspace): Promise<void> {
	process.chdir(fixture.previous_cwd)
	fixture.restore_environment?.()
	await rm(fixture.workspace, { force: true, recursive: true })
}

const git_fixture_workspace = {
	AUTHOR_NAME,
	close_workspace,
	git,
	IDENTITY_OPTIONS,
	MAIN_BRANCH,
	open_workspace,
}

export type { FixtureWorkspace }
export { git_fixture_workspace }
