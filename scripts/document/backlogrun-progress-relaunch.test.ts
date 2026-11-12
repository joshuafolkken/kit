import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A child lost in a session cut is re-dispatched by `lane:launch`, the composite that already runs
// `lane:open`'s checks and then `lane:dispatch` — never by the two steps typed from prose
// (joshuafolkken/kit#5939).
const BACKLOGRUN_PROGRESS_MD = '.claude/skills/workflow-commands/backlogrun-progress.md'
const LOST_IN_THE_CUT = 'cut is re-dispatched with `pnpm josh lane:launch <N>`.'
const TWO_STEP = '`pnpm josh lane:open <N>` then `pnpm josh lane:dispatch <N>`'

describe('backlogrun-progress.md — a child lost in the cut', () => {
	it('points at lane:launch rather than the open-then-dispatch steps', () => {
		const text = readFileSync(BACKLOGRUN_PROGRESS_MD, 'utf8')

		expect(text).toContain(LOST_IN_THE_CUT)
		expect(text).not.toContain(TWO_STEP)
	})
})
