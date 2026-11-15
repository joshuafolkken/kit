// The josh command a process tree started from (joshuafolkken/kit#7593). The dispatcher marks the
// outermost command once and every nested `pnpm josh` inherits the mark, so a command can tell a call
// typed at a shell from one another josh command made. A launched lane child starts with the mark
// blank (`lane-child-marker.ts`), so the calls its session types read as its own.
const KEY = 'JOSH_OUTER_COMMAND'

type Environment = Record<string, string | undefined>

function mark(command: string, environment: Environment = process.env): void {
	if ((environment[KEY] ?? '') === '') environment[KEY] = command
}

function is_outermost(command: string, source: Readonly<Environment> = process.env): boolean {
	return source[KEY] === command
}

const outer_command = { KEY, is_outermost, mark }

export { outer_command }
