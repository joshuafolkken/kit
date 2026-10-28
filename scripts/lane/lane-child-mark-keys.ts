// The environment keys a launcher marks a lane child with, in a module of their own so the unit
// suite's vitest config reads them without widening its import graph (`whole-suite-files.ts`).
// `lane-child-marker.ts` documents each mark; a mark added there is added here, and the unit suite
// then blanks it with no list of its own (joshuafolkken/kit#5029).

const KEY = 'JOSH_LANE_CHILD'
const OVERRUN_KEY = 'JOSH_LANE_OVERRUN'
const MARK_KEYS: ReadonlyArray<string> = [KEY, OVERRUN_KEY]

const lane_child_mark_keys = { KEY, MARK_KEYS, OVERRUN_KEY }

export { lane_child_mark_keys }
