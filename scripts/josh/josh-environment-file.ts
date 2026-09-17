import { ENV_FILE_NAME } from '#ports'

// Loading `.env` from inside a command, for the commands that must stay in-process.
//
// **The flag form is what most commands use, and it is not free.** Declaring any `tsx_arguments`
// disqualifies a command from in-process dispatch (`josh-in-process.ts`), which puts a second
// ~0.16 s tsx start in front of every call — the hot path joshuafolkken/kit#1342 took it off. A
// command a hook fires on every `Bash` call, or one an unattended `epicrun` polls every sixty
// seconds, cannot pay that, so it reads the file itself instead.
//
// `process.loadEnvFile` is node's own `--env-file` parser and keeps node's precedence: a value
// already in the environment wins over the file's. A missing or unreadable file is swallowed,
// exactly as `--env-file-if-exists` does.
//
// **Call it only on the real command path** — inside the `import.meta.url` guard, or the hook's own
// entry — never from a function a unit test calls, so a developer's own `.env` cannot decide what
// the tests see.
function load_environment_file(): void {
	try {
		process.loadEnvFile(ENV_FILE_NAME)
	} catch {
		// No `.env` beside this project, or one this process may not read. The caller then reads from
		// the environment alone, which is what it did before any file existed.
	}
}

const josh_environment_file = {
	load_environment_file,
}

export { josh_environment_file }
