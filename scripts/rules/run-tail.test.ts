import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_batch_guard } from '#scripts/time/time-batch-guard'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'
import { run_tail } from './run-tail'

// joshuafolkken/kit#1510: the trigger has to fire on the foreground push step and on nothing else.
// Fired too widely it refuses a `git commit` whose message quotes the step, or the recovery path that
// only opens a pull request; fired too narrowly it misses a spelling, and the rule is delivered on no
// run at all. This suite owns the trigger, the delivery text, and the row's wiring — the enumeration's
// own invariants stay in `delivered-rules.test.ts`.

const BASH = 'Bash'
const RUN_TAIL = 'run-tail'
const FOREGROUND_PUSH = 'pnpm josh git -y "Stop a run tail idling #1510"'
// The documented recovery path: the push already landed, so this only opens the pull request.
const SKIPPED_PUSH = 'pnpm josh git -y --skip-commit --skip-push'
// A josh subcommand whose name starts with the same letters — outside the trigger and outside the
// denominator alike.
const NOT_THE_PUSH_STEP = 'pnpm josh gate'
const NOW_MS = 1_700_000_000_000
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'run-tail-'))
const WRITTEN_TRANSCRIPTS = new Set<string>()

function call_of(command: string, is_background?: boolean): { name: string; input: unknown } {
	const input =
		is_background === undefined ? { command } : { command, run_in_background: is_background }

	return { name: BASH, input }
}

function payload_of(
	name: string,
	command: string,
	tool_name = BASH,
	is_background = false,
): string {
	const transcript = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(transcript, '')
	WRITTEN_TRANSCRIPTS.add(transcript)

	const tool_input = is_background ? { command, run_in_background: true } : { command }

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name,
		tool_input,
	})
}

// Assigned rather than deleted: an empty value is not one the disabled list recognizes, so the guard
// reads as on exactly as it does on a fresh machine.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(delivered_rules.delivery_path(RUN_TAIL, transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('is_push_step', () => {
	it.each([
		['pnpm josh git -y "title #1510"'],
		['pnpm josh g -y "title #1510"'],
		['josh git -y'],
		['pnpm exec josh git --yes "a title"'],
		['pnpm run josh git -y "a title"'],
		['pnpm josh gate && pnpm josh git -y "a title"'],
		// The two spellings the first cut of this trigger missed: an environment assignment in front
		// of it, and a subshell whose closing parenthesis ends the flag.
		['JOSH_CI_TIMEOUT_SECONDS=600 pnpm josh git -y "a title"'],
		['(pnpm josh git -y)'],
		['npx josh git -y "a title"'],
		// **A flag named inside the title is not a flag.** `josh git` takes the title positionally, and
		// this repository quotes flag names in titles constantly — the commit that shipped this rule is
		// itself such a title, and would have exempted itself from it.
		['pnpm josh git -y "Exclude --skip-push from the run-tail trigger #1510"'],
	])('matches %j', (command) => {
		expect(run_tail.is_push_step(command)).toBe(true)
	})

	it.each([
		// Without the confirmation flag it is a person's interactive invocation, not the run's step.
		['pnpm josh git'],
		// Anchoring is what keeps a quoted mention out: the segment's command is `git`, not `josh`.
		['git commit -m "ran pnpm josh git -y"'],
		// A different subcommand whose name starts with the same letters.
		[NOT_THE_PUSH_STEP],
		['pnpm josh followup "a title"'],
		// The documented recovery path: the push already landed, so there is no tail to save.
		[SKIPPED_PUSH],
		// The confirmation flag quoted inside the title is not the confirmation flag either.
		['pnpm josh git "a title with -y in it"'],
		[''],
	])('leaves %j alone', (command) => {
		expect(run_tail.is_push_step(command)).toBe(false)
	})
})

describe('is_foreground_push_step', () => {
	it('fires on the push step issued in the foreground', () => {
		expect(run_tail.is_foreground_push_step(call_of(FOREGROUND_PUSH))).toBe(true)
	})

	// The exemption is the whole point: a run that already backgrounds it pays nothing.
	it('leaves the same command alone once it is backgrounded', () => {
		expect(run_tail.is_foreground_push_step(call_of(FOREGROUND_PUSH, true))).toBe(false)
	})

	it('fires when the field is present and false', () => {
		expect(run_tail.is_foreground_push_step(call_of(FOREGROUND_PUSH, false))).toBe(true)
	})

	// Refusing a write tool would leave a turn half applied, so no tool but `Bash` is a candidate.
	it('says nothing about a write tool whose input looks like the push step', () => {
		const call = { name: 'Edit', input: { command: FOREGROUND_PUSH } }

		expect(run_tail.is_foreground_push_step(call)).toBe(false)
	})

	it('says nothing when the input carries no command', () => {
		expect(run_tail.is_foreground_push_step({ name: BASH, input: undefined })).toBe(false)
	})
})

// **The compliance side of the same rule** (joshuafolkken/kit#1643). The trigger above fires only on
// the foreground spelling, so `rule-value.ts` needs the act in either spelling for its denominator and
// the detached one for its numerator — without the first, a run that backgrounded every push would
// drop out of the reading and the rate would be taken over runs that pushed in the foreground.
describe('is_push_step_call and is_backgrounded_push_step', () => {
	const BACKGROUND_FIELDS: ReadonlyArray<boolean | undefined> = [undefined, true, false]

	it.each(BACKGROUND_FIELDS)('reaches the rule whatever run_in_background says (%j)', (field) => {
		expect(run_tail.is_push_step_call(call_of(FOREGROUND_PUSH, field))).toBe(true)
	})

	it('leaves a call that is not the push step out of the denominator', () => {
		const write = { name: 'Edit', input: { command: FOREGROUND_PUSH } }

		expect(run_tail.is_push_step_call(call_of(NOT_THE_PUSH_STEP))).toBe(false)
		expect(run_tail.is_push_step_call(write)).toBe(false)
	})

	it('credits the push step only once it is issued detached', () => {
		expect(run_tail.is_backgrounded_push_step(call_of(FOREGROUND_PUSH, true))).toBe(true)
		expect(run_tail.is_backgrounded_push_step(call_of(FOREGROUND_PUSH))).toBe(false)
		expect(run_tail.is_backgrounded_push_step(call_of(SKIPPED_PUSH, true))).toBe(false)
	})
})

describe('rule_delivery — the run tail at the call that pushes in the foreground', () => {
	it('delivers the rule on the foreground commit-push-PR step', () => {
		const reason = rule_delivery(payload_of(RUN_TAIL, FOREGROUND_PUSH), NOW_MS)

		expect(reason).toBe(delivered_rules.RUN_TAIL_REASON)
	})

	// **A push is a recurring act, so the rule recurs with it.** One per child in a `queue` or an
	// `epicrun`, and a second inside one `fullrun` when round 2 fixes a finding in place — refused
	// once and free afterwards, every push but the first is back to the run's self-restraint.
	it('delivers again on the next foreground push rather than once per run', () => {
		const payload = payload_of('run-tail-repeat', FOREGROUND_PUSH)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.RUN_TAIL_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBe(delivered_rules.RUN_TAIL_REASON)
	})

	// **The rule obeyed costs nothing**, which is what makes refusing the foreground call honest: the
	// reissue the reason asks for has to pass, or obeying would wedge the run.
	it('says nothing once the same step is issued in the background', () => {
		const payload = payload_of('run-tail-background', FOREGROUND_PUSH, BASH, true)

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})

	// **Never wired to a write** (joshuafolkken/kit#1390), the same omission every row depends on.
	it('says nothing about a write tool even when its input looks like the push step', () => {
		const payload = payload_of('run-tail-write', FOREGROUND_PUSH, 'Edit')

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})

	// The recovery path opens a pull request for a push that already succeeded. Refusing it would
	// spend a delivery on a call with no tail to save.
	it('says nothing about the recovery path that skips the push', () => {
		const payload = payload_of('run-tail-skip', SKIPPED_PUSH)

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})

	// The push step is never a candidate of the batching guard, so this row has no stand-aside to
	// make — which is why `decide` is supplied rather than falling to `is_first_delivery`.
	it('is not a call the batching guard may also refuse', () => {
		expect(time_batch_guard.is_guarded_call(call_of(FOREGROUND_PUSH))).toBe(false)
	})
})

describe('RUN_TAIL_REASON', () => {
	it.each([
		// The reissue, which is the only thing that makes the refusal actionable.
		['run_in_background'],
		// The second half a run forgets once the push has landed.
		['pnpm josh followup'],
		['never ends at the push'],
		// The cap is what actually produced symptom 1, so it is stated rather than implied.
		['above the harness cap'],
		// The boundary, so the rule does not read as contradicting the foreground rule for followup.
		['foreground'],
		// The pointer to the procedure, and the two Issues the rule rests on.
		['§2h'],
		['joshuafolkken/kit#1510'],
		['joshuafolkken/kit#1333'],
		// A recurring rule has to say so, or a reader treats one refusal as the whole of it.
		['fires on every foreground push, not once per run'],
		// joshuafolkken/kit#1462 measured the tail this rule used to say did not exist, so the rule
		// carries what to do with it — not only that `followup` stays in the foreground.
		['joshuafolkken/kit#1462'],
		['read the merge result stay after'],
	])('carries %j', (marker) => {
		expect(run_tail.RUN_TAIL_REASON).toContain(marker)
	})

	// The retracted premise, kept as a negative assertion rather than deleted quietly: an agent told
	// there is nothing to overlap after the merge leaves the whole tail where joshuafolkken/kit#1462
	// measured it (joshuafolkken/kit#1510 wrote it, joshuafolkken/kit#1462 disproved it).
	it.each([['nothing follows it'], ['nothing to overlap']])('no longer claims %j', (retracted) => {
		expect(run_tail.RUN_TAIL_REASON).not.toContain(retracted)
	})
})
