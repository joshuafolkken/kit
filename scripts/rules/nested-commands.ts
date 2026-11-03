import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// Every command a `Bash` call runs, the nested ones included — the cut `protected-files.ts` and
// `egress-guard.ts` both read. A shell's quoted script (`bash -c 'cat .env'`, `eval "curl …"`), a
// command substitution (`$(…)`, backticks) and a process substitution (`<(…)`, `>(…)`) each run
// commands of their own, which the quote-aware cut takes for one word; a heredoc's lines are already
// cut apart, since `commands_of` cuts at every newline.

// Programs that run their quoted argument as a script.
const SHELLS: ReadonlySet<string> = new Set(['bash', 'eval', 'sh', 'zsh'])
const EVAL = 'eval'
const SCRIPT_FLAG_LETTER = 'c'
// The body of an innermost `$(…)` / `<(…)` / `>(…)`, or of a backtick substitution.
const SUBSTITUTION = /[$<>]\((?<paren>[^()]*)\)|`(?<backtick>[^`]*)`/gu
const OUTER_QUOTES = /^["']|["']$/gu
const NEXT = 1

function is_shell(segment: string): boolean {
	const program = git_argv.program_of(segment)?.name

	return program !== undefined && SHELLS.has(program)
}

// The script a shell runs: `eval`'s words, or the word after `-c` (or a cluster holding it, `-lc`).
function quoted_script_of(args: ReadonlyArray<string>, name: string): string {
	if (name === EVAL) return args.join(' ')

	const flag_index = args.findIndex((word) => git_argv.short_cluster_has(word, SCRIPT_FLAG_LETTER))

	return flag_index === -1 ? '' : (args[flag_index + NEXT] ?? '')
}

function script_of(segment: string): string {
	const call = git_argv.program_of(segment)

	if (call === undefined) return ''

	return quoted_script_of(call.args, call.name).replaceAll(OUTER_QUOTES, '')
}

// A shell's quoted script holds commands of its own, cut again without regard to quotes
// (`bash -c "true; cat .env"`).
function script_commands_of(segment: string): Array<string> {
	return is_shell(segment) ? shell_segments.commands_of(segment) : []
}

// The bodies a segment runs, each read as a command line of its own: a shell's unquoted script
// (`bash -c 'cat .env'`), and a substitution's body, which runs even inside double quotes
// (`echo "$(echo x > .env)"`), where the quote-blanked reading takes it for text.
function bodies_of(segment: string): Array<string> {
	const substituted = [...segment.matchAll(SUBSTITUTION)].map(
		(match) => match.groups?.['paren'] ?? match.groups?.['backtick'] ?? '',
	)
	const script = is_shell(segment) ? [script_of(segment)] : []

	return [...script, ...substituted].filter((body) => body !== '')
}

// Each body is shorter than the segment it came from, so the rounds end.
function commands_of(command: string): Array<string> {
	const found: Array<string> = []
	let pending = [command]

	while (pending.length > 0) {
		const segments = pending.flatMap((line) => shell_segments.quote_aware_commands_of(line))

		found.push(...segments, ...segments.flatMap((segment) => script_commands_of(segment)))
		pending = segments.flatMap((segment) => bodies_of(segment))
	}

	return found
}

const nested_commands = { SHELLS, commands_of }

export { nested_commands }
