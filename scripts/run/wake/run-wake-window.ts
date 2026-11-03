import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// **The driver is bounded so the supervisor reaches its pass boundary between dispatches**
// (joshuafolkken/kit#4509): unbounded, `backlog:drive` dispatches, collects and merges lanes in its own
// loop until a judgment hand-off, and the code check at the pass boundary would wait for that. Kept
// apart from `run-wake-driver.ts`, so a ship's reload wait reads it without the driver's imports
// (joshuafolkken/kit#5987).
const WINDOW_MINUTES = 5
const WINDOW_MS = WINDOW_MINUTES * MS_PER_MINUTE

export const run_wake_window = { WINDOW_MINUTES, WINDOW_MS }
