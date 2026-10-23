import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { ENV_FILE_NAME } from '#ports'
import { OPTIONAL_ENV_FILE_FLAGS } from './josh-command-types'

// Loading `.env` from inside a command, for the commands that must stay in-process.
//
// **The flag form is what most commands use, and it is not free.** Declaring any `tsx_arguments`
// disqualifies a command from in-process dispatch (`josh-in-process.ts`), which puts a second
// ~0.16 s tsx start in front of every call. A
// command a hook fires on every `Bash` call, or one an unattended `epicrun` polls every sixty
// seconds, cannot pay that, so it reads the file itself instead.
//
// `parseEnv` is node's own `--env-file` parser, and the loader keeps node's precedence: a value
// already in the environment wins over the file's. A missing or unreadable file is swallowed,
// exactly as `--env-file-if-exists` does.
//
// **A switch that turns a guard or a gate off is never taken from the file** (kit #4660): the run
// can write `.env`, so a switch read from it would let the run switch off the guards that bind it. It
// counts only from the environment the session was launched with — `JOSH_RULE_GUARD=off claude`. The
// flag form is loaded through the same filter (`apply_node_flags`), so a process kit starts never
// inherits a switch from the file either.
//
// **Call it only on the real command path** — inside the `import.meta.url` guard, or the hook's own
// entry — never from a function a unit test calls, so a developer's own `.env` cannot decide what
// the tests see.

// Every `JOSH_*_GUARD` switch, the hooks' `JOSH_*_FORCE` skips and the gate's `JOSH_SCOPED_GREEN`.
const LAUNCH_ONLY_KEY = /^JOSH_(?:\w+_GUARD|\w+_FORCE|SCOPED_GREEN)$/u

function is_launch_only_key(key: string): boolean {
	return LAUNCH_ONLY_KEY.test(key)
}

function read_environment_file(): string {
	try {
		return readFileSync(ENV_FILE_NAME, 'utf8')
	} catch {
		// No `.env` beside this project, or one this process may not read. The caller then reads from
		// the environment alone, which is what it did before any file existed.
		return ''
	}
}

function load_environment_file(): void {
	const entries = Object.entries(parseEnv(read_environment_file()))

	for (const [key, value] of entries) {
		if (!is_launch_only_key(key) && process.env[key] === undefined) process.env[key] = value
	}
}

// The node flags a spawned command is started with. The `.env` flag is loaded here, into the
// environment the child inherits, rather than handed to node, whose own loader cannot leave the
// launch-only keys out.
function apply_node_flags(flags: ReadonlyArray<string>): ReadonlyArray<string> {
	const [environment_flag] = OPTIONAL_ENV_FILE_FLAGS

	if (!flags.includes(environment_flag ?? '')) return flags

	load_environment_file()

	return flags.filter((flag) => flag !== environment_flag)
}

const josh_environment_file = {
	apply_node_flags,
	load_environment_file,
}

export { josh_environment_file }
