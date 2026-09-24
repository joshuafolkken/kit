// The environment variable the network guard's record is handed to the test workers under
// (joshuafolkken/kit#2494). The `gh` and `git` shims carry the record's path baked into their own
// script, but an in-process guard — the Telegram one wraps `fetch` inside each worker — has nothing
// baked in, so `arm` exports the path and every worker inherits it with `PATH`.
//
// A module of its own because both sides must name it and neither may load the other: the network
// guard runs in Vitest's main process and must not import `vitest`, and the Telegram guard runs in
// every worker, where loading the network guard would resolve the guarded repository with a `git`
// spawn once per test file.
const GUARD_LOG_KEY = 'JOSH_UNIT_GUARD_LOG'

export { GUARD_LOG_KEY }
