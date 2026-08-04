import type { CommandEntry } from './josh-command-types'

const SHELL_INTERPRETERS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash'])
const SHELL_COMMAND_FLAG = '-c'
const PATH_SEPARATOR = '/'
const USAGE_ERROR_EXIT_CODE = 1

// The interpreter is matched on its basename so an absolute path counts too: `/bin/sh -c` behaves
// exactly like `sh -c`, and the repo already spells it both ways.
function is_shell_interpreter(executable: string): boolean {
	return SHELL_INTERPRETERS.has(executable.split(PATH_SEPARATOR).at(-1) ?? executable)
}

// `sh -c '<script>'` turns anything appended into the shell's positional parameters. The script
// string never expands them, so the arguments vanish without a word — `josh test --workers=1`
// reads as a serial run while the suite stays parallel, and a green or red result is attributed
// to a configuration that was never applied. Detecting the shape instead of tagging each command
// is what makes this permanent: a composite added later cannot reopen the hole by forgetting to
// opt in. Non-composite entries (`pnpm exec prettier --check .`) append to the real tool and
// forward correctly, so they keep doing so.
function is_composite_shell(shell: ReadonlyArray<string> | undefined): boolean {
	const [executable, flag] = shell ?? []
	if (executable === undefined) return false

	return is_shell_interpreter(executable) && flag === SHELL_COMMAND_FLAG
}

function format_targets(targets: ReadonlyArray<string>): string {
	return targets.map((target) => `josh ${target}`).join(' or ')
}

function format_rejection(cmd: string, targets: ReadonlyArray<string>): string {
	const hint =
		targets.length > 0
			? `pass them to ${format_targets(targets)} instead`
			: 'it runs a fixed sequence and forwards nothing'

	return `josh ${cmd} takes no extra arguments — ${hint}`
}

// Returns the message to print, or undefined when the invocation is fine. Keeping the decision
// separate from the printing lets the rule be asserted without capturing console output.
function reject_extra_arguments(
	cmd: string,
	entry: CommandEntry,
	extra: ReadonlyArray<string>,
): string | undefined {
	if (extra.length === 0 || !is_composite_shell(entry.shell)) return undefined

	return format_rejection(cmd, entry.argument_targets ?? [])
}

const composite_arguments = { format_rejection, is_composite_shell, reject_extra_arguments }

export { composite_arguments, USAGE_ERROR_EXIT_CODE }
