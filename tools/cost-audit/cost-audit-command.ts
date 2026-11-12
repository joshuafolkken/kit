import { time_shell } from '#scripts/time-runtime/time-shell'

// The row key of a Bash command in `josh cost:audit`'s per-command table (joshuafolkken/kit#7137):
// the command and up to two subcommand words — `git status`, `gh issue view`, `pnpm vitest run` —
// stopping at the first word not shaped like a subcommand. A flag, path, number or quoted pattern ends
// the key, so `sed -n 1,20p a.ts` and `sed -n 5,9p b.ts` share the `sed` row. The command is read
// from the segment `time_shell` names as the one that runs, its wrappers and `cd x &&` dropped. A
// josh call, with or without a subcommand, keys as `''`: the josh table counts it.

const KEY_WORD_LIMIT = 3
const SUBCOMMAND_PATTERN = /^[a-z][\w:-]*$/u

function command_key(command: string): string {
	const segment = time_shell.command_segment(command)

	if (segment === '' || time_shell.runs_josh(segment)) return ''

	const [head = '', ...rest] = time_shell.command_words(segment)
	const stop = rest.findIndex((word) => !SUBCOMMAND_PATTERN.test(word))
	const subcommands = stop === -1 ? rest : rest.slice(0, stop)

	return [head, ...subcommands.slice(0, KEY_WORD_LIMIT - 1)].join(' ')
}

const cost_audit_command = { command_key }

export { cost_audit_command }
