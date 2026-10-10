#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { run_carry } from '#scripts/run/carry/run-carry'
import { josh_environment_file } from './josh-environment-file'
import { session_language, type Resolution } from './session-language'

// `josh session:lang` — say, on stdout, which language this session writes in, so a
// `SessionStart` / `UserPromptSubmit` hook injects the resolved value into context every turn.
// Before this, `JOSH_SESSION_LANG` lived only in `.env` — a personal,
// non-committed file the harness never loads into the process environment — so the value was
// invisible unless the agent read the file itself, and a one-word prompt like `diag` had nothing to
// infer a language from and drifted to the surrounding English.
//
// **The `.env` read reuses the one loader** (`josh_environment_file.load_environment_file`) rather
// than a second parser, and keeps node's precedence: a value already in the process environment wins
// over the file's. Unset, empty and no-`.env` all resolve to `ja`, because a worktree without a
// `.env`, a cloud session and a consumer repository are exactly where the drift recurs.
//
// The line itself is a script-fixed string, so it stays English by the same rule that pins the
// Telegram header labels and the `--notify-message` default (`CLAUDE.md` → "Output language").

//
// **The same hook carries the board rule while a `backlogrun` is live.** The rule
// that a progress question is answered with `run:board --chat` is read only by the session driving a
// run, so a session asked from the side never met it. The prompt is the one moment every session
// shares, and the line is gated on the run being live, so a repository with no run pays nothing for
// it. Live is `backlogrun_launch.is_running`'s answer, not a second reading of the records.

const { DEFAULT_SESSION_LANG, ENV_KEY, resolve_session_lang } = session_language

const BOARD_LINE =
	'A backlogrun is live here: answer a progress question with `pnpm josh run:board --chat`, verbatim in one code block.'

interface LivePorts {
	// The common git directory the run's records are keyed on; `undefined` outside a repository.
	repository_directory: () => Promise<string | undefined>
	is_running: (git_directory: string) => boolean
}

const LIVE_PORTS: LivePorts = {
	repository_directory: run_carry.repository_directory,
	is_running: backlogrun_launch.is_running,
}

// The file load happens in `main`, on the command path only; the resolver reads the environment.
// The line carries the value alone: what the language covers is `CLAUDE.md` → "Output language",
// already in context every turn, so repeating it here only spent context on each prompt. The default
// prints nothing — that resident line already names `ja`.
function format_line(resolution: Resolution): string {
	if (resolution.is_default) return ''

	return `Session language (${ENV_KEY}): ${resolution.lang}`
}

// A throw is answered `false`: a hook that failed here would cost the prompt its language line too.
async function is_run_live(ports: LivePorts = LIVE_PORTS): Promise<boolean> {
	try {
		const git_directory = await ports.repository_directory()

		return git_directory !== undefined && ports.is_running(git_directory)
	} catch {
		return false
	}
}

function prompt_lines(resolution: Resolution, is_live: boolean): Array<string> {
	return [format_line(resolution), is_live ? BOARD_LINE : ''].filter((line) => line !== '')
}

async function main(): Promise<void> {
	josh_environment_file.load_environment_file()
	const lines = prompt_lines(resolve_session_lang(), await is_run_live())

	for (const line of lines) console.info(line)
}

const session_language_cli = {
	BOARD_LINE,
	DEFAULT_SESSION_LANG,
	ENV_KEY,
	format_line,
	is_run_live,
	prompt_lines,
	resolve_session_lang,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export type { LivePorts }
export { session_language_cli }
