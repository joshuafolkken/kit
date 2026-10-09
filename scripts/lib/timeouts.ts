// Shared time limits for the calls that leave the process — a network request or a spawned command.
// An unattended run (a lane, `followup`, a backlog drain) that waits on a request or a command with no
// limit stays stuck where it stopped and never comes back, so every such
// call takes one of these, and a value used in more than one place is named once here.

// A probe that only asks the local machine (`ps`, `lsof`, `git config`) on a path something else is
// waiting on. Failing answers "cannot tell", which every caller handles, so anything slower is a fault.
const PROBE_TIMEOUT_MS = 2000
// One HTTP request to a registry, an API or a webhook.
const FETCH_TIMEOUT_MS = 10_000
// One local `git` command. Generous for a `rev-parse`; a call that talks to a remote needs its own.
const GIT_TIMEOUT_MS = 10_000
// A hook's spawned formatter or spell check, which holds the edit's turn open while it runs. Read it
// against the worst-case run, not one spawn: an edit to a config input plans eslint, prettier and
// `eslint_d restart`, the first and last each with a second route behind the daemon — five spawns.
// The hook entry in `.claude/settings.json` declares 90 seconds, so five of these must fit under it,
// or the harness kill lands at a moment the hook did not choose — possibly inside `prettier --write`,
// which rewrites in place and can leave the file truncated. 15s × 5 = 75s. It is still two orders of
// magnitude beyond the 0.84s a warm run takes, so reaching it means something is already wrong.
const HOOK_PROCESS_TIMEOUT_MS = 15_000
// One `gh api` read whose answer only shapes a report or a classification.
const GH_API_TIMEOUT_MS = 20_000
// A short command that only answers a question (`gh --version`, `pnpm config get`).
const COMMAND_TIMEOUT_MS = 30_000
// A type-aware ESLint run over a few files. A cold one is seconds; this is two orders beyond that.
const LINT_TIMEOUT_MS = 180_000
// A `pnpm install` or a global install, which can download the whole dependency tree on a cold
// store. Ten minutes covers that fetch and still ends the command when a registry never answers. It
// is well under `SUITE_TIMEOUT_MS` because it blocks a command a person is waiting on.
const INSTALL_TIMEOUT_MS = 600_000
// A check or step that can run a consumer's full unit suite or a `pnpm add` — long enough for a cold
// suite on a large consumer, short enough that a hung child ends the run instead of holding it open
// with nothing printed (buffered output shows nothing at all until this fires).
const SUITE_TIMEOUT_MS = 1_800_000

export {
	COMMAND_TIMEOUT_MS,
	FETCH_TIMEOUT_MS,
	GH_API_TIMEOUT_MS,
	GIT_TIMEOUT_MS,
	HOOK_PROCESS_TIMEOUT_MS,
	INSTALL_TIMEOUT_MS,
	LINT_TIMEOUT_MS,
	PROBE_TIMEOUT_MS,
	SUITE_TIMEOUT_MS,
}
