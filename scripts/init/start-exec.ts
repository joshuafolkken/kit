import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { execaSync } from 'execa'

// The three spawn shapes every `josh start` step uses, shared by `start-steps.ts`, the setup pull
// request step and the `josh init` hint so none of them keeps a copy of its own.
function succeeds(command: string, args: ReadonlyArray<string>, root: string): boolean {
	return execaSync(command, args, { cwd: root, reject: false }).exitCode === 0
}

function read_output(
	command: string,
	args: ReadonlyArray<string>,
	root: string,
): string | undefined {
	const result = execaSync(command, args, { cwd: root, reject: false })

	return result.exitCode === 0 ? result.stdout.trim() : undefined
}

// Every step spawned here dials GitHub directly, past a scanner's loopback proxy, the same as every
// other `gh` spawn under scripts/ (joshuafolkken/kit#2436); a local `git` step is unaffected by it.
function run(command: string, args: ReadonlyArray<string>, root: string): void {
	execaSync(command, args, { ...git_gh_exec.direct_environment(), cwd: root, stdio: 'inherit' })
}

const start_exec = { succeeds, read_output, run }

export { start_exec }
