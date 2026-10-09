import { describe, expect, it } from 'vitest'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { context } = stop_rules_fixture

// joshuafolkken/kit#2329: every stop reason ends on this, so a correction never reprints the reply.
const NO_REPRINT = 'do not repeat your previous reply'
const BARE_MESSAGE = 'done in #7'
const QUOTING_PROMPT = 'explain this log: closed #7'

describe('stop_rules.stop_outcome — stop notification', () => {
	it('refuses a held tree that stopped without notifying', () => {
		const { reason } = stop_rules.stop_outcome(context({ hold_present: true }))

		expect(reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})

	it('is silent when the confirmation notify is on the tail', () => {
		const outcome = stop_rules.stop_outcome(context({ hold_present: true, notified: true }))

		expect(outcome).toEqual(stop_rules.NO_OUTCOME)
	})

	it('is silent on a turn holding no hold', () => {
		expect(stop_rules.stop_outcome(context({})).reason).toBeUndefined()
	})
})

// joshuafolkken/kit#2962: a lane child that handed its region to the detached ship waits on nobody.
describe('stop_rules.stop_outcome — hand-off to the detached ship', () => {
	it('demands no notify from a lane child handed to a running ship', () => {
		const handed_off = context({ lane_child: true, hold_present: true, handed_off: true })

		expect(stop_rules.stop_outcome(handed_off)).toEqual(stop_rules.NO_OUTCOME)
	})

	it('demands no hold release either, since the supervisor owns the hold', () => {
		const handed_off = context({
			lane_child: true,
			hold_present: true,
			tree_clean: true,
			notified: true,
			handed_off: true,
		})

		expect(stop_rules.stop_outcome(handed_off)).toEqual(stop_rules.NO_OUTCOME)
	})

	it('still demands the notify from a lane child that parks for a decision', () => {
		const parked = context({ lane_child: true, hold_present: true, handed_off: false })

		expect(stop_rules.stop_outcome(parked).reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})
})

describe('stop_rules.stop_outcome — hold release', () => {
	it('refuses a clean tree that still holds', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, notified: true }),
		)

		expect(outcome.reason).toBe(stop_rules.HOLD_RELEASE_REASON)
	})

	it('is silent when the tree is dirty (halfrun / needs-human-review)', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: false, notified: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})

	it('is silent for a prrun stop that keeps its hold over a clean tree', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, notified: true, prrun_stopped: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})

	it('still demands the notify at a prrun stop', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, prrun_stopped: true }),
		)

		expect(outcome.reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})
})

describe('stop_rules.stop_outcome — loop breaker', () => {
	it('does not refuse once stop_hook_active is set', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, stop_hook_active: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — pre-gate cut', () => {
	it('does not refuse a lane child ending its turn at the cut', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, cut_pending: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — issue citation', () => {
	it('blocks a bare #N by naming it and the issue:cite call that fixes it', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: 'done in #123 and #456' }))

		expect(reason).toContain('#123, #456')
		expect(reason).toContain('pnpm josh issue:cite 123 456')
		expect(reason).toContain('issue-citation.md')
	})

	it('carries an owner/repo#N reference through to the issue:cite argument', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: 'see joshuafolkken/kit#45' }))

		expect(reason).toContain('pnpm josh issue:cite joshuafolkken/kit#45')
	})

	// joshuafolkken/kit#2329: the fix follows the bare copy as a correction, not a reprint of the whole
	// reply — reprinting is what read as a duplicate.
	it('asks for the correction alone, not the whole reply reissued', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: BARE_MESSAGE }))

		expect(reason).toContain(NO_REPRINT)
	})

	it('is silent on a link-form citation', () => {
		const message = 'done in [#123](https://github.com/o/r/issues/123)'

		expect(stop_rules.stop_outcome(context({ message })).reason).toBeUndefined()
	})

	it('does not block a bare #N once stop_hook_active is set', () => {
		const outcome = stop_rules.stop_outcome(
			context({ message: BARE_MESSAGE, stop_hook_active: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})

	it('lets an earlier block rule take precedence over the citation rule', () => {
		const outcome = stop_rules.stop_outcome(context({ hold_present: true, message: 'paused #7' }))

		expect(outcome.reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})
})

// joshuafolkken/kit#2819: a pasted log from another repository carries its own numbers.
describe('stop_rules.stop_outcome — issue citation quoted from the prompt', () => {
	it('is silent on a bare #N the prompt already carried', () => {
		const outcome = stop_rules.stop_outcome(
			context({ message: BARE_MESSAGE, prompt: QUOTING_PROMPT }),
		)

		expect(outcome.reason).toBeUndefined()
	})

	it('still blocks a bare #N the prompt did not carry', () => {
		const { reason } = stop_rules.stop_outcome(
			context({ message: 'done in #7 and #8', prompt: QUOTING_PROMPT }),
		)

		expect(reason).toContain('pnpm josh issue:cite 8')
		expect(reason).not.toContain('issue:cite 7')
	})
})

// joshuafolkken/kit#2329: all three stop reasons end on "do not repeat your previous reply" so a
// correction never reprints the reply already on screen.
describe('stop_rules reasons — the correction is a diff, not a reprint', () => {
	it.each([
		['stop notification', stop_rules.STOP_NOTIFY_REASON],
		['hold release', stop_rules.HOLD_RELEASE_REASON],
		['filing offer', stop_rules.FILING_OFFER_REASON],
	])('%s does not ask for a reprint', (_name, reason) => {
		expect(reason).toContain(NO_REPRINT)
	})
})

// joshuafolkken/kit#2437: a headless parent's turn-end kills its background waits with the process.
describe('stop_rules.stop_outcome — headless parent', () => {
	it('refuses a headless parent that would end its turn with lanes in flight', () => {
		const { reason } = stop_rules.stop_outcome(context({ headless_waiting: true }))

		expect(reason).toBe(stop_rules.HEADLESS_WAIT_REASON)
		expect(reason).toContain('pnpm josh run:carry --cut --owner "$PPID"')
	})

	it('is not stood down by the loop-breaker or a pending cut', () => {
		const outcome = stop_rules.stop_outcome(
			context({ headless_waiting: true, stop_hook_active: true, cut_pending: true }),
		)

		expect(outcome.reason).toBe(stop_rules.HEADLESS_WAIT_REASON)
	})

	it('lets a spinning parent stop once the refusal cap is reached', () => {
		const spinning = context({
			headless_waiting: true,
			stop_hook_active: true,
			headless_refusals: stop_rules.HEADLESS_REFUSAL_CAP,
		})

		expect(stop_rules.stop_outcome(spinning).reason).toBeUndefined()
	})

	it('counts the refusals on a transcript tail', () => {
		const tail = `a ${stop_rules.HEADLESS_WAIT_REASON} b ${stop_rules.HEADLESS_WAIT_REASON}`

		expect(stop_rules.count_headless_refusals(tail)).toBe(2)
	})

	it('resets the count at a foreground wait', () => {
		const refusal = stop_rules.HEADLESS_WAIT_REASON
		const tail = `${refusal} ${refusal} {"command":"pnpm josh lane:await 12"} ${refusal}`

		expect(stop_rules.count_headless_refusals(tail)).toBe(1)
	})

	it('lets a parent with nothing to wait on stop', () => {
		expect(stop_rules.stop_outcome(context({ headless_waiting: false })).reason).toBeUndefined()
	})
})

describe('stop_rules — the headless parent leaves the watching to the supervisor', () => {
	// joshuafolkken/kit#3245: the run:wake driver watches the lanes, so the woken session no longer
	// polls them; a heartbeat it starts anyway is still not a foreground wait.
	it('does not send the parent to the heartbeat and does not count it as a foreground wait', () => {
		const refusal = stop_rules.HEADLESS_WAIT_REASON
		const tail = `${refusal} {"command":"pnpm josh run:progress --wait"} ${refusal}`

		expect(refusal).not.toContain('run:progress --wait')
		expect(stop_rules.count_headless_refusals(tail)).toBe(2)
	})
})

// joshuafolkken/kit#2445: a lane child stopped to ask a person for `git add` on a tree the
// sanctioned commit flow could already finish.
const INDEX_REQUEST =
	'The conflict is resolved; please grant permission to run `git add` on the file.'

describe('stop_rules.stop_outcome — lane index permission', () => {
	it('refuses a lane child that stops asking for index permission', () => {
		const { reason } = stop_rules.stop_outcome(
			context({ lane_child: true, message: INDEX_REQUEST }),
		)

		expect(reason).toBe(stop_rules.LANE_INDEX_REASON)
		expect(reason).toContain('pnpm josh git -y')
		expect(reason).toContain(NO_REPRINT)
	})

	it('goes ahead of the stop notification a held lane would owe', () => {
		const held = context({ lane_child: true, hold_present: true, message: INDEX_REQUEST })

		expect(stop_rules.stop_outcome(held).reason).toBe(stop_rules.LANE_INDEX_REASON)
	})

	it('asks the same in Japanese', () => {
		const message = '`git add` の許可をください'

		expect(stop_rules.stop_outcome(context({ lane_child: true, message })).reason).toBe(
			stop_rules.LANE_INDEX_REASON,
		)
	})

	it('stays silent outside a lane child', () => {
		expect(stop_rules.stop_outcome(context({ message: INDEX_REQUEST })).reason).toBeUndefined()
	})

	it('stays silent on a report that only names the command', () => {
		const message = 'Committed through `pnpm josh git -y`, which ran `git add` itself.'

		expect(stop_rules.stop_outcome(context({ lane_child: true, message })).reason).toBeUndefined()
	})

	it('honours the loop-breaker', () => {
		const repeated = context({ lane_child: true, message: INDEX_REQUEST, stop_hook_active: true })

		expect(stop_rules.stop_outcome(repeated).reason).toBeUndefined()
	})
})

// joshuafolkken/kit#2492: the run's stream is watched from a pane of its own, so no stop is held to
// relay it — an event landing never costs the attached conversation a turn.
describe('stop_rules.stop_outcome — no stop is held to relay the event stream', () => {
	it('lets an attached session with a run going end its turn', () => {
		expect(stop_rules.stop_outcome(context({ lane_child: false })).reason).toBeUndefined()
	})
})

describe('stop_rules envelopes and payload', () => {
	it('blocks with a decision envelope', () => {
		expect(JSON.parse(stop_rules.block_envelope('r', 'en'))).toMatchObject({ decision: 'block' })
	})

	it('parses a valid Stop payload and rejects a malformed one', () => {
		expect(stop_rules.parse_stop_payload('{"transcript_path":"/t"}')?.transcript_path).toBe('/t')
		expect(stop_rules.parse_stop_payload('{}')).toBeUndefined()
	})
})
