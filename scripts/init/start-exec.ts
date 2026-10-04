import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { execaSync } from 'execa'

// The three spawn shapes every `josh start` step uses, shared by `start-steps.ts`, the setup pull
// request step and the `josh init` hint so none of them keeps a copy of its own.
//
// The three git-driving shapes below act on `root`, so `cwd` has to mean it: an inherited `GIT_DIR` and friends beat `cwd`
// and would carry a `git init` or commit into whichever repository a calling hook was firing in
// (joshuafolkken/kit#3151).
function root_environment(): Record<string, string | undefined> {
	return git_location_environment.location_free_environment()
}

function succeeds(command: string, args: ReadonlyArray<string>, root: string): boolean {
	return (
		execaSync(command, args, { cwd: root, env: root_environment(), reject: false }).exitCode === 0
	)
}

function read_output(
	command: string,
	args: ReadonlyArray<string>,
	root: string,
): string | undefined {
	const result = execaSync(command, args, { cwd: root, env: root_environment(), reject: false })

	return result.exitCode === 0 ? result.stdout.trim() : undefined
}

// Every step spawned here dials GitHub directly, past a scanner's loopback proxy, the same as every
// other `gh` spawn under scripts/ (joshuafolkken/kit#2436); a local `git` step is unaffected by it.
function run(command: string, args: ReadonlyArray<string>, root: string): void {
	const environment = { ...root_environment(), ...git_gh_exec.direct_environment().env }

	execaSync(command, args, { env: environment, cwd: root, stdio: 'inherit' })
}

// A caller's own initialize command stands in for the in-process `josh init`, so it keeps the
// environment that setup would have had — its install goes through a scanner's proxy as usual.
function run_local(command: string, args: ReadonlyArray<string>, root: string): void {
	execaSync(command, args, { cwd: root, stdio: 'inherit' })
}

const start_exec = { succeeds, read_output, run, run_local }

export { start_exec }
