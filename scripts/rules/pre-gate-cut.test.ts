import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import type { RunCut } from '#scripts/run/run-cut'
import { time_batch_guard } from '#scripts/time/time-batch-guard'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { pre_gate_cut, type LaneCutState } from './pre-gate-cut'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'
import { rule_value, type RuleReading } from './rule-value'
import { rule_value_fixture } from './rule-value-fixture'

// joshuafolkken/kit#1864: the pre-gate cut fired 0 times in 6 lane children while it was carried as
// prose, so this suite owns the two halves that decide whether the refusal fires at all — the command
// match, and the "is this a lane that has not cut" read. **Both directions matter equally**: a row
// that stays silent in a lane leaves the measured defect exactly where it was, and one that speaks in
// an ordinary checkout refuses the gate of every `fullrun` there is.

const BASH = 'Bash'
const RULE_ID = 'pre-gate-cut'
const ISSUE = '1864'
const GATE = 'pnpm josh gate'
const TAKE_THE_CUT = `pnpm josh run:cut ${ISSUE}`
// The three spellings that ask about a cut rather than take one — the entry check above all, which
// four of the six measured children issued before walking straight on to the gate.
const RESUME_CHECK = `pnpm josh run:cut --resume ${ISSUE}`
const END_THE_CUT = 'pnpm josh run:cut --end'
// The entry step the `fresh` verdict sends a run on to and the `resume` verdict tells its counterpart
// to skip — the one call that separates a cut run's two sessions (joshuafolkken/kit#1867).
const CLAIM_THE_HOLD = `pnpm josh run:hold ${ISSUE}`
const NOW_MS = 1_700_000_000_000
const SAYS_NOTHING = 'says nothing about %j'
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'pre-gate-cut-'))
// The directory vitest was launched from, restored before WORK_DIRECTORY is removed. The suite pins its
// working directory to the non-lane WORK_DIRECTORY per test to stay hermetic wherever it was launched: the delivery
// and measurement paths read the live process.cwd() to decide whether a checkout is a lane, so a run
// started inside a lane worktree (`.kit-lanes/<N>`) would otherwise see every silence-expecting case
// fire the pre-gate-cut refusal (joshuafolkken/kit#1884).
const ENTRY_DIRECTORY = process.cwd()
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()

function cut_of(issue: string): RunCut {
	return {
		invocation: `fullrun #${issue}`,
		issue,
		branch: `${issue}-lane`,
		phase: 'pre-gate',
		cut_at: new Date(NOW_MS).toISOString(),
		is_handed_off: false,
	}
}

// The dispatched-child case the refusal exists for: the mark names this lane's own issue.
function state_of(directory: string, cut?: RunCut): LaneCutState {
	function carried(): RunCut | undefined {
		return cut
	}

	return { directory, carried, marked_issue: ISSUE }
}

// A lane checkout whose mark is absent (a person working there) or names another issue (a leak from
// the parent session) — the cases that must stay silent. `marked_issue` is required, so passing
// `undefined` here is meaningful rather than a redundant default.
function state_marked(directory: string, marked_issue: string | undefined): LaneCutState {
	return { ...state_of(directory), marked_issue }
}

function call_of(command: string): { name: string; input: unknown } {
	return { name: BASH, input: { command } }
}

// One run's transcript: lone calls in the order given, each its own turn.
function run_of(...commands: ReadonlyArray<string>): Array<string> {
	return [rule_value_fixture.session(...commands)]
}

function pre_gate_row(runs: ReadonlyArray<ReadonlyArray<string>>): RuleReading {
	return rule_value_fixture.reading_for(RULE_ID, runs)
}

function payload_of(name: string, command: string, tool_name = BASH): string {
	const transcript = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(transcript, '')
	WRITTEN_TRANSCRIPTS.add(transcript)

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name,
		tool_input: { command },
	})
}

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
	// Every test starts with no dispatch mark, so a leak from the lane-checkout block below cannot fire
	// the refusal in a case that expects silence; the lane block sets it in its own beforeEach.
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	process.chdir(WORK_DIRECTORY)
})

afterAll(() => {
	process.chdir(ENTRY_DIRECTORY)

	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(delivered_rules.delivery_path(RULE_ID, transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('cwd isolation', () => {
	// **The suite pins its own working directory** (joshuafolkken/kit#1884). Removing the beforeEach
	// chdir leaves cwd at wherever vitest was launched, so this fails everywhere; launched from a lane
	// worktree it would additionally read as a lane and fire the refusal on every gate case below.
	it('runs the silence assertions from the non-lane work directory', () => {
		const here = process.cwd()

		// realpathSync so the assertion holds on macOS, where process.cwd() resolves the /tmp symlink
		// to /private/tmp while WORK_DIRECTORY keeps the tmpdir() spelling.
		expect(here).toBe(realpathSync(WORK_DIRECTORY))
		expect(pre_gate_cut.uncut_lane_issue(state_of(here))).toBeUndefined()
	})
})

describe('runs_the_gate', () => {
	it.each([
		[GATE],
		// The alias is expanded rather than matched as text, so the short spelling is the same call.
		['pnpm josh ga'],
		['pnpm josh gate --verbose'],
		// A chain: the gate is one segment of it, and each segment is judged on its own.
		['git switch main && pnpm josh gate'],
	])('reads %j as a gate run', (command) => {
		expect(pre_gate_cut.runs_the_gate(command)).toBe(true)
	})

	it.each([
		['pnpm josh lint'],
		['pnpm josh test:unit'],
		// **The word is not the command.** A commit title that mentions the gate is not a gate run, and
		// the segment it sits in begins with a different josh subcommand.
		['pnpm josh git -y "Start the gate beside the review #1242"'],
		['echo gate'],
	])(SAYS_NOTHING, (command) => {
		expect(pre_gate_cut.runs_the_gate(command)).toBe(false)
	})
})

describe('takes_the_cut', () => {
	it.each([[TAKE_THE_CUT], [`pnpm josh rct ${ISSUE}`]])('reads %j as taking the cut', (command) => {
		expect(pre_gate_cut.takes_the_cut(command)).toBe(true)
	})

	// **The three asking spellings are not the cut**, and this is the distinction the measurement
	// turned on: four of the six children issued `--resume`, were answered `fresh`, and went straight
	// to the gate. A predicate that counted any `run:cut` would credit exactly those runs.
	it.each([
		[RESUME_CHECK],
		[END_THE_CUT],
		['pnpm josh run:cut --json'],
		[`pnpm josh run:hold ${ISSUE}`],
	])(SAYS_NOTHING, (command) => {
		expect(pre_gate_cut.takes_the_cut(command)).toBe(false)
	})
})

// **The denominator `pnpm josh rule:value` scores this row over.** A lane child issues the entry
// check whatever it goes on to do, so the command in any spelling is what a transcript can answer;
// the gate would enrol every ordinary non-lane run, where the rule can never be kept.
describe('asks_about_the_cut', () => {
	it.each([[TAKE_THE_CUT], [RESUME_CHECK], [END_THE_CUT]])(
		'reads %j as reaching the occasion',
		(command) => {
			expect(pre_gate_cut.asks_about_the_cut(command)).toBe(true)
		},
	)

	it.each([[GATE], [`pnpm josh run:hold ${ISSUE}`]])(SAYS_NOTHING, (command) => {
		expect(pre_gate_cut.asks_about_the_cut(command)).toBe(false)
	})
})

describe('claims_the_hold', () => {
	it.each([[CLAIM_THE_HOLD], [`pnpm josh rh ${ISSUE}`]])(
		'reads %j as claiming the working tree',
		(command) => {
			expect(pre_gate_cut.claims_the_hold(command)).toBe(true)
		},
	)

	// **`run:release` is the other end of the same record and is not the claim.** A run that only ever
	// released one made no claim of its own, and reading it as one would put the resumed session — which
	// releases at its merge — straight back into the denominator this predicate exists to keep it out of.
	it.each([
		[TAKE_THE_CUT],
		[RESUME_CHECK],
		[`pnpm josh run:release ${ISSUE}`],
		// The release written as the hold script's own flag, which the subcommand name alone reads as a
		// claim.
		[`pnpm josh run:hold --release ${ISSUE}`],
		[GATE],
	])(SAYS_NOTHING, (command) => {
		expect(pre_gate_cut.claims_the_hold(command)).toBe(false)
	})
})

describe('uncut_lane_issue', () => {
	it('names the issue when the checkout sits in a lane and no cut was taken', () => {
		expect(pre_gate_cut.uncut_lane_issue(state_of(LANE_DIRECTORY))).toBe(ISSUE)
	})

	// **The resumed process is the one that must stay silent.** `adopt_cut` leaves the record in place
	// with `is_handed_off: false`, so a carried record naming this issue means the cut already
	// happened and this process is the one it produced.
	it('says nothing once a cut record for that issue is carried', () => {
		const state = state_of(LANE_DIRECTORY, cut_of(ISSUE))

		expect(pre_gate_cut.uncut_lane_issue(state)).toBeUndefined()
	})

	// A record belonging to a different issue says nothing about this lane.
	it('still names the issue when the carried record belongs to another one', () => {
		const state = state_of(LANE_DIRECTORY, cut_of('1850'))

		expect(pre_gate_cut.uncut_lane_issue(state)).toBe(ISSUE)
	})

	// **A person working in the lane carries no dispatch mark, so the rule stays silent for them**
	// (joshuafolkken/kit#1904). This is the half that used to be the model's to judge.
	it('says nothing when the lane carries no dispatch mark', () => {
		const state = state_marked(LANE_DIRECTORY, undefined)

		expect(pre_gate_cut.uncut_lane_issue(state)).toBeUndefined()
	})

	// **A mark that leaked in from the parent session names some other issue**, so requiring it to
	// equal this lane's issue reads the leak as a person too.
	it('says nothing when the dispatch mark names another issue', () => {
		const state = state_marked(LANE_DIRECTORY, '1850')

		expect(pre_gate_cut.uncut_lane_issue(state)).toBeUndefined()
	})

	it.each([[LANE_ROOT], [WORK_DIRECTORY], [path.join(LANE_ROOT, 'main')]])(
		'says nothing about %j, which is not a lane checkout',
		(directory) => {
			expect(pre_gate_cut.uncut_lane_issue(state_of(directory))).toBeUndefined()
		},
	)
})

describe('is_uncut_gate', () => {
	it('fires on a gate run in an uncut lane', () => {
		expect(pre_gate_cut.is_uncut_gate(GATE, state_of(LANE_DIRECTORY))).toBe(true)
	})

	it('says nothing about a gate run once the cut is carried', () => {
		const state = state_of(LANE_DIRECTORY, cut_of(ISSUE))

		expect(pre_gate_cut.is_uncut_gate(GATE, state)).toBe(false)
	})

	it('says nothing about a gate run outside a lane', () => {
		expect(pre_gate_cut.is_uncut_gate(GATE, state_of(WORK_DIRECTORY))).toBe(false)
	})

	it('says nothing about a gate run in a lane with no dispatch mark', () => {
		const state = state_marked(LANE_DIRECTORY, undefined)

		expect(pre_gate_cut.is_uncut_gate(GATE, state)).toBe(false)
	})

	it('says nothing about the cut itself, issued in the same lane', () => {
		expect(pre_gate_cut.is_uncut_gate(TAKE_THE_CUT, state_of(LANE_DIRECTORY))).toBe(false)
	})
})

describe('rule_delivery — the pre-gate cut at the call that runs the gate', () => {
	// **The ordinary case is silence, and it is the assertion that matters most.** This suite runs in
	// the repository's own checkout, which is not a lane — exactly where a `fullrun` runs its gate.
	it('says nothing about a gate run in a checkout that is not a lane', () => {
		expect(rule_delivery(payload_of('pre-gate-cut-plain', GATE), NOW_MS)).toBeUndefined()
	})

	it('says nothing about a write tool whose input looks like a gate run', () => {
		expect(rule_delivery(payload_of('pre-gate-cut-write', GATE, 'Edit'), NOW_MS)).toBeUndefined()
	})

	// The gate is never a candidate of the batching guard, so this row makes no stand-aside — which is
	// what lets it fall to the shared once-per-run record rather than deciding for itself.
	it('is not a call the batching guard may also refuse', () => {
		expect(time_batch_guard.is_guarded_call(call_of(GATE))).toBe(false)
	})

	// The cut this rule asks for must itself pass every row in the enumeration — a refusal on the
	// remedy would leave a run with nothing it is allowed to do.
	it('leaves the cut command unclaimed by every rule in the enumeration', () => {
		const claiming = delivered_rules.DELIVERED_RULES.filter((rule) =>
			rule.is_trigger(call_of(TAKE_THE_CUT)),
		)

		expect(claiming).toStrictEqual([])
	})
})

describe('rule_delivery — inside a lane checkout', () => {
	const ORIGINAL_DIRECTORY = process.cwd()

	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		// A real dispatched child arrives here with the mark set; `current_state` reads it from the live
		// environment, so the delivery cases below only fire once it names this lane.
		process.env[lane_child_marker.KEY] = ISSUE
	})

	afterAll(() => {
		process.chdir(ORIGINAL_DIRECTORY)
		Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	})

	// The temporary lane sits outside any repository, so the git directory cannot be read and the cut
	// reads as not taken — which is the same answer a real lane gives before its cut.
	it('delivers the rule on a gate run that has not cut', () => {
		const reason = rule_delivery(payload_of('pre-gate-cut-lane', GATE), NOW_MS)

		expect(reason).toBe(delivered_rules.PRE_GATE_CUT_REASON)
	})

	// **Once per run, so obeying can never wedge the run.** Five verdicts — `not-a-lane`, `unready`,
	// `busy`, `failed` and `unknown` — legitimately leave this process at the gate, and each of them
	// needs the reissue to pass.
	it('says nothing on the reissued gate run', () => {
		const payload = payload_of('pre-gate-cut-once', GATE)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.PRE_GATE_CUT_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})

	it('says nothing about the cut command itself', () => {
		expect(rule_delivery(payload_of('pre-gate-cut-take', TAKE_THE_CUT), NOW_MS)).toBeUndefined()
	})
})

// **The two sessions of one cut run, which the row used to read as two runs** (joshuafolkken/kit#1867).
// A cut relaunches a fresh process, so a perfectly obedient lane child reaches the measurement as two
// transcripts issuing the identical entry check — and only the first of them can ever take a cut, so
// scored on the asking alone the row had a ceiling of about 50%.
describe('rule_value.measure — the pre-gate cut row', () => {
	it('counts the session that claimed the working tree and took the cut as a run that kept the rule', () => {
		const reading = pre_gate_row([run_of(RESUME_CHECK, CLAIM_THE_HOLD, TAKE_THE_CUT)])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(1)
	})

	it('counts a lane child that held the tree and ran the gate uncut as reached, never as kept', () => {
		const reading = pre_gate_row([run_of(RESUME_CHECK, CLAIM_THE_HOLD, GATE)])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(0)
	})

	// It skips the fresh hold claim by specification and has no cut of its own left to take, so counting
	// it enrolled a session that could only ever be scored as a failure.
	it('leaves the session the cut produced out of the denominator', () => {
		expect(pre_gate_row([run_of(RESUME_CHECK, GATE)]).sessions).toBe(0)
	})

	it('reads one obedient lane child at 100%, not at the half its two sessions used to read', () => {
		const cut = run_of(RESUME_CHECK, CLAIM_THE_HOLD, TAKE_THE_CUT)
		const resumed = run_of(RESUME_CHECK, GATE)

		expect(rule_value.unaided_rate(pre_gate_row([cut, resumed]))).toBe(100)
	})
})

describe('PRE_GATE_CUT_REASON', () => {
	it.each([
		// The command that fixes it — the only thing that makes a refusal actionable.
		['pnpm josh run:cut <N>'],
		// What `cut` obliges, which is the half a run cannot infer from the verdict alone.
		['end the turn immediately'],
		// The five verdicts that leave this process holding the run.
		['not-a-lane'],
		['busy'],
		// The pointer, and the reissue sentence every delivery needs.
		['.claude/skills/workflow-commands/pre-gate-cut.md'],
		['once per run'],
	])('carries %j', (marker) => {
		expect(delivered_rules.PRE_GATE_CUT_REASON).toContain(marker)
	})
})
