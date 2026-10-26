// **Switched off, a pre-commit lint hook neither reserves the core budget nor runs** — set by `josh
// ship`'s local commit (`run-ship-sync.ts`), whose tree the gate or the scoped pair checks before
// anything is pushed (joshuafolkken/kit#4985). On by default like every other distributed guard. Its
// own module because the hook is an entry with a main guard, which nothing may import.
const SWITCH_ENV_KEY = 'JOSH_PRE_COMMIT_LINT'

const pre_commit_lint_switch = { SWITCH_ENV_KEY }

export { pre_commit_lint_switch }
