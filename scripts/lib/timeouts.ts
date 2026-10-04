// Shared time limits for the calls that leave the process — a network request or a spawned command.
// An unattended run (a lane, `followup`, a backlog drain) that waits on a request or a command with no
// limit stays stuck where it stopped and never comes back (joshuafolkken/kit#2981), so every such
// call takes one of these, and a value used in more than one place is named once here.

// One HTTP request to a registry, an API or a webhook.
const FETCH_TIMEOUT_MS = 10_000
// A short command that only answers a question (`gh --version`, `pnpm config get`).
const COMMAND_TIMEOUT_MS = 30_000
// A `pnpm install`, which can download the whole dependency tree on a cold store.
const INSTALL_TIMEOUT_MS = 600_000

export { COMMAND_TIMEOUT_MS, FETCH_TIMEOUT_MS, INSTALL_TIMEOUT_MS }
