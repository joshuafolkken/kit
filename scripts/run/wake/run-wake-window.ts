import { backlog_dispatch_bound } from '#scripts/backlog/backlog-dispatch-bound'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// **The driver is bounded so the supervisor reaches its pass boundary between dispatches**
// (joshuafolkken/kit#4509): unbounded, `backlog:drive` dispatches, collects and merges lanes in its own
// loop until a judgment hand-off, and the code check at the pass boundary would wait for that. Kept
// apart from `run-wake-driver.ts`, so a ship's reload wait reads it without the driver's imports
// (joshuafolkken/kit#5987).
const WINDOW_MINUTES = 5
const WINDOW_MS = WINDOW_MINUTES * MS_PER_MINUTE
// **The supervisor's pause between passes is its own, not the driver's offer interval**
// (joshuafolkken/kit#6718): a pass reads local records, and the backlog only through the driver, so
// stretching the offer interval for the REST budget must not slow how soon a judgment hand-off is seen.
// A pass may start a fresh driver, so the pause is what the dispatch bound leaves after that start
// (joshuafolkken/kit#7507).
const PASS_INTERVAL_MS = backlog_dispatch_bound.NOTICE_MS

export const run_wake_window = { WINDOW_MINUTES, WINDOW_MS, PASS_INTERVAL_MS }
