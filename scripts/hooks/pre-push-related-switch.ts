// **Switched on, a pre-push unit run the gate record does not cover runs the related tests rather than
// the whole suite** — set by `josh ship`'s push ahead of the gate (`run-ship-sync.ts`), whose gate over
// the same tree runs the whole suite next (joshuafolkken/kit#5067). Off by default. Its own module
// because the hook is an entry with a main guard, which nothing may import.
const SWITCH_ENV_KEY = 'JOSH_PRE_PUSH_RELATED'
const SWITCH_ON = '1'

const pre_push_related_switch = { SWITCH_ENV_KEY, SWITCH_ON }

export { pre_push_related_switch }
