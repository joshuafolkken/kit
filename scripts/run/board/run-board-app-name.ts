import path from 'node:path'

// The name an app is drawn under on `run:board`'s 💻 processes section, computed from its command.
// `run-board-process-groups.ts` remembers each command's answer, so a redraw names only the processes
// new since the last one (joshuafolkken/kit#4263).

const APP_SUFFIX = '.app'
const COMMAND_SEPARATOR = ' '

// An app's name: the outermost `.app` bundle its executable sits in, else its command's own name.
function app_of(command: string): string {
	const bundle = command.split(path.sep).find((part) => part.endsWith(APP_SUFFIX))

	if (bundle !== undefined) return bundle.slice(0, -APP_SUFFIX.length)

	const executable = command.startsWith(path.sep) ? command : command.split(COMMAND_SEPARATOR)[0]

	return path.basename(executable ?? command)
}

const run_board_app_name = { app_of }

export { run_board_app_name }
