// The environment variable the network guard's record is handed to the test workers under.
// The `gh` and `git` shims carry the record's path baked into their own
// script, but an in-process guard — the Telegram one wraps `fetch` inside each worker — has nothing
// baked in, so `arm` exports the path and every worker inherits it with `PATH`.
//
// A module of its own because both sides must name it and neither may load the other: the network
// guard runs in Vitest's main process and must not import `vitest`, and the Telegram guard runs in
// every worker, where loading the network guard would resolve the guarded repository with a `git`
// spawn once per test file.
const GUARD_LOG_KEY = 'JOSH_UNIT_GUARD_LOG'

// The test file a worker is running, relative to the checkout (`test-file-environment.ts` sets it
// per file). A `PATH` shim cannot see which test spawned it, but it inherits the spawning worker's
// environment, so this is how a recorded call names its test file (joshuafolkken/kit#7638).
const TEST_FILE_KEY = 'JOSH_UNIT_TEST_FILE'
// What separates a recorded command from its test file: a tab, which no command prose here carries.
const TEST_FILE_SEPARATOR = '\t'
// The tail every shim record line ends in, expanded by `sh` when the call is made. `${NAME-}` so a
// call from outside any test file (`globalSetup`) records an empty file rather than failing.
const TEST_FILE_SUFFIX = `${TEST_FILE_SEPARATOR}\${${TEST_FILE_KEY}-}`

export { GUARD_LOG_KEY, TEST_FILE_KEY, TEST_FILE_SEPARATOR, TEST_FILE_SUFFIX }
