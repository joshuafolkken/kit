import { lane_paths } from '#scripts/lane/lane-paths'
import { run_cut, type RunCut } from '#scripts/run/run-cut'
import { shell_segments } from './shell-segments'

// The pre-gate cut, delivered at the call it binds on (joshuafolkken/kit#1864).
//
// **The mechanism was there and nothing called it.** joshuafolkken/kit#1839 built the cut and
// joshuafolkken/kit#1850 measured the result: across six lane children — #1853, #1849, #1855, #1854,
// #1856 and #1847 — the cut was taken **0 times**. Four of the six issued the *entry* check
// `pnpm josh run:cut --resume <N>` and were answered `fresh`; not one issued `pnpm josh run:cut <N>`,
// the call that actually cuts. The procedure was read three to five times per run and remained one
// step of prose in the middle of it, so joshuafolkken/kit#1839's fourth acceptance condition — the
// drop in context per request — could not be judged at all.
//
// **This is the third time prose lost to a refusal.** joshuafolkken/kit#1344 measured three
// consecutive runs in which resident text about batching moved the number not at all, and
// joshuafolkken/kit#1460 measured the same for the investigation threshold; in both, a `PreToolUse`
// refusal was what finally moved it. A step a run is free to skip is a step that gets skipped under
// time pressure, and `run:hold` — the one boundary step that never gets missed — is the one that
// refuses.

const GATE_COMMANDS: ReadonlySet<string> = new Set(['gate'])
const CUT_COMMANDS: ReadonlySet<string> = new Set(['run:cut'])
// The three spellings that ask about a cut rather than take one: the fresh process's entry check, the
// teardown, and the record read. **Excluding them is the whole point** — four of the six measured
// children issued `--resume` and went straight on to the gate, so a predicate that counted any
// `run:cut` would have been silent on exactly the runs this rule exists for.
const CUT_MODE_FLAG = /(?:^|\s)--(?:resume|end|json)(?:[=\s]|$)/u
// **The one entry call the resumed half never makes** (joshuafolkken/kit#1867).
// `.claude/skills/workflow-commands/pre-gate-cut.md` sends a `fresh` verdict on to "claim the hold,
// ask the session boundary, read the issue, implement", and tells a `resume` verdict to "skip the
// title, the plan, the fresh hold claim and the implementation". So the hold claim is what a run made
// on the near side of the pre-gate boundary carries and the process the cut produced does not.
const HOLD_COMMANDS: ReadonlySet<string> = new Set(['run:hold'])
// **A release is not a claim, and the subcommand name alone cannot tell the two apart.** `run:release`
// is registered as the hold script under `--release`, so a segment naming the hold command may be
// either — the same asymmetry `CUT_MODE_FLAG` exists for one command up. Reading a release as a claim
// would put the resumed session, which releases at its merge, straight back into the denominator this
// predicate exists to keep it out of.
const HOLD_MODE_FLAG = /(?:^|\s)--release(?:[=\s]|$)/u

// **Alias-expanded rather than matched as text**, so `pnpm josh ga` and `pnpm josh rct` are the same
// calls as their canonical spellings. Segment-wise for the reason every other row here is: one shell
// line carries several commands, and a name quoted inside a body is not the command being invoked.
//
// **One reading of that question rather than one per name set.** Four predicates here differ only in
// which subcommands they look for and which mode flag turns the call into a different one, and a
// second copy of the walk is the clone `CLAUDE.md` prohibits — the copy nobody corrected would be the
// one that stops seeing an alias. `mode_flag` is optional because two of the four ask about the
// subcommand whatever mode it was invoked in.
function invokes_josh(command: string, names: ReadonlySet<string>, mode_flag?: RegExp): boolean {
	return shell_segments
		.segments_of(command)
		.some(
			(segment) =>
				shell_segments.is_josh_command(segment, names) && mode_flag?.test(segment) !== true,
		)
}

function runs_the_gate(command: string): boolean {
	return invokes_josh(command, GATE_COMMANDS)
}

function takes_the_cut(command: string): boolean {
	return invokes_josh(command, CUT_COMMANDS, CUT_MODE_FLAG)
}

// Whether this command claims the working tree, in either spelling and in neither release spelling.
function claims_the_hold(command: string): boolean {
	return invokes_josh(command, HOLD_COMMANDS, HOLD_MODE_FLAG)
}

// **One half of the occasion, never the whole of it** (joshuafolkken/kit#1867). Taken alone this
// predicate enrols both processes of one obedient lane child: the cut relaunches a second session
// which issues this same entry check byte for byte and can never take a cut of its own, so the row
// read at half its true rate. `delivered-rules.ts` pairs it with `claims_the_hold`, which only the
// near half of the boundary makes.
//
// **The occasion the rule governs, as far as a transcript can answer it.** A lane child issues
// `pnpm josh run:cut --resume <N>` at its entry whatever it goes on to do, so a run that reaches for
// the command in any spelling is one this rule could have bound on. Whether a checkout *is* a lane is
// read from the working directory and appears nowhere in a transcript, so it cannot be the
// denominator — and taking the gate as the occasion instead would enrol every ordinary non-lane run,
// where the rule can never be kept, and `pnpm josh rule:value` would read the row low by
// construction. joshuafolkken/kit#1643 names exactly that failure.
function asks_about_the_cut(command: string): boolean {
	return invokes_josh(command, CUT_COMMANDS)
}

// What the trigger has to know about the world, passed in so the decision itself is testable without
// a lane on disk and without a git call.
interface LaneCutState {
	directory: string
	carried: (now?: Date) => RunCut | undefined
}

function current_state(): LaneCutState {
	return { directory: process.cwd(), carried: run_cut.carried_cut_sync }
}

// **The resumed process must stay silent, and the cut record is what says so.** After a cut,
// `adopt_cut` leaves the record in place with `is_handed_off: false`, so a carried record naming this
// issue means the process asking is the one the cut already produced. Without this half the rule
// would fire on the fresh process too — refusing a gate call on a run that had kept the rule
// perfectly, which `prompts/collaboration-workflow/rule-delivery.md` calls worse than no hook at all.
function uncut_lane_issue(state: LaneCutState): string | undefined {
	const issue = lane_paths.lane_issue_of(state.directory)

	if (issue === undefined) return undefined

	return state.carried()?.issue === issue ? undefined : issue
}

// **The command test comes first and the world is consulted second.** This predicate is asked of
// every `Bash` call in the run, so the cheap string match is what keeps a git call off all of them
// but the handful that actually run the gate.
function is_uncut_gate(command: string, state: LaneCutState = current_state()): boolean {
	if (!runs_the_gate(command)) return false

	return uncut_lane_issue(state) !== undefined
}

// The instruction in the shape a refusal can carry: what the cut is for, what each verdict means, and
// the reissue sentence every delivery needs. **The verdicts are spelled out rather than pointed at**,
// because `cut` is the only one that ends the turn and a run told merely to "take the cut" would have
// to go and read which of the other five leave it holding the run — the same reason the WIP cap's
// delivery names its three interrupt tests instead of naming the file they live in.
const PRE_GATE_CUT_REASON =
	'⛔ pre-gate cut: this checkout is a lane and the gate is the boundary to cut at, so take the cut ' +
	'before running it. `pnpm josh run:cut <N>` ends this process and relaunches a fresh one that ' +
	'resumes from the gate, dropping the thinking built up while implementing rather than carrying it ' +
	'on every later request — joshuafolkken/kit#1839 measured 176K of 204K output riding across that ' +
	'boundary, and joshuafolkken/kit#1864 measured the step itself firing 0 times in 6 lane children ' +
	'while it was carried as prose. Issue `pnpm josh run:cut <N>` now, and read the verdict: on `cut`, ' +
	'**end the turn immediately** — the fresh process owns the run from there and must not be waited ' +
	'for; on `not-a-lane`, `unready`, `busy`, `failed` or `unknown`, this process carries the run on ' +
	'and the gate is simply the next call. Never relaunch a second process after `busy`. **If you are ' +
	'a person working in this lane rather than a dispatched child, do not take the cut** — it would ' +
	'launch a detached run behind you; reissue the gate instead, which passes because this fires once ' +
	'per run. The procedure is `.claude/skills/workflow-commands/pre-gate-cut.md`. Reissue the gate ' +
	'once the cut has answered — it cannot repeat on the call in hand.'

const pre_gate_cut = {
	PRE_GATE_CUT_REASON,
	asks_about_the_cut,
	claims_the_hold,
	is_uncut_gate,
	runs_the_gate,
	takes_the_cut,
	uncut_lane_issue,
}

export type { LaneCutState }
export { pre_gate_cut }
