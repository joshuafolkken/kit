import { MS_PER_SECOND } from '#scripts/lib/timeouts'

// **The one bound on how long an issue ready to start waits for its `child-launch`**
// (joshuafolkken/kit#7507): counted from when it became ready, or from when a seat freed if none was free. The driver's and
// the supervisor's waits are derived from it rather than given figures of their own, so no interval can
// outgrow it alone. Kept free of the driver's imports, so the supervisor's window reads it cheaply.
const DISPATCH_BOUND_SECONDS = 60
const DISPATCH_BOUND_MS = DISPATCH_BOUND_SECONDS * MS_PER_SECOND

// A fresh driver's start up to its first dispatch, as measured in joshuafolkken/kit#7507, rounded up.
const DRIVER_START_SECONDS = 25
const DRIVER_START_MS = DRIVER_START_SECONDS * MS_PER_SECOND

// What is left of the bound to notice a change, where a fresh driver may still have to start after it.
const NOTICE_MS = DISPATCH_BOUND_MS - DRIVER_START_MS

export const backlog_dispatch_bound = { DISPATCH_BOUND_MS, DRIVER_START_MS, NOTICE_MS }
