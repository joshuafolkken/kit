import {
	AI_DOCS,
	read_unwrapped,
	read_unwrapped_rule_surface,
	RULE_DELIVERY_RATIONALE,
	WORKFLOW_PROMPT_DIRECTORY,
} from '#scripts/document/ai-document-fixture'
import { time_batch_guard } from '#scripts/time-runtime/time-batch-guard'
import { describe, expect, it } from 'vitest'
import { rule_list } from './rule-list'

// joshuafolkken/kit#1304: measured on four merged runs, a `fullrun` issued between 1.00 and 1.13 tool
// calls per round trip — independent reads and edits went out one per turn. On #1295 the 34 `Edit`
// calls and the 32 small read-only `Bash` calls executed for about 54 seconds between them while the
// 66 turns they sat in cost 600–850, so the run's floor was set by the round trips rather than by
// the work.
//
// joshuafolkken/kit#1524 took the rule out of `CLAUDE.md`: its trigger can be named as one tool
// call, so it is delivered at that call instead of carried on every turn. **What pins it is
// therefore firing, not residency** — the prose was resident through all four of the runs measured
// above and moved none of them, which is the whole reason the criterion changed. So this suite
// guards three things: the delivered text carrying every sentence that changes what an agent does,
// the resident document no longer carrying a rule it does not hold, and the reasoning staying at the
// pointer rather than being pasted back into either.
const TOPIC_FILE = 'turn-batching.md'
const CANONICAL = `${WORKFLOW_PROMPT_DIRECTORY}/${TOPIC_FILE}`
const DELIVERY = `${WORKFLOW_PROMPT_DIRECTORY}/rule-delivery.md`
const RESIDENCY = `${WORKFLOW_PROMPT_DIRECTORY}/residency.md`
// joshuafolkken/kit#3177 moved the measurements, the rejected mechanisms and the resident-rule list
// out of the topic files into these English rationale documents, so the markers follow them there.
const RATIONALE = 'docs/maintainers/turn-batching-rationale.md'
const RESIDENCY_RATIONALE = 'docs/maintainers/residency-rationale.md'
const SUITE_PATH = 'scripts/rules/turn-batching-rule.test.ts'
// The trigger that now delivers the rule. Named once: the enumeration, the residency list and this
// suite have to agree on the command, and a string kept correct in one of three places is not kept.
const GUARD_COMMAND = 'pnpm josh batch:guard'
// The figures the issue was filed on. Quotable enough to be the first thing pasted back into an
// always-loaded document, which is what makes them the marker for "the reasoning stayed put".
const MEASUREMENTS: ReadonlyArray<string> = ['600–850', '1.13']

// Every sentence here changes what an agent does. Drop the criterion and it reads as a rule about
// reading, which a turn issuing one `Edit` at a time walks straight past; drop the last and "fewer
// turns" reads as permission to skip a check. **They are asserted against the delivered text**,
// because that is the only place an agent now meets them.
describe('the delivered text — what the refusal states', () => {
	const delivered = time_batch_guard.REASON

	it.each([
		"needs another call's result",
		'not what kind of call it is',
		'edits are covered exactly as',
		'never authorizes weakening a verification gate or a review',
	])('carries %j', (marker) => {
		expect(delivered).toContain(marker)
	})

	// A reference to `CLAUDE.md` names nothing once the rule has left it, and the pointer is where the
	// reasoning actually is.
	it('names the topic file rather than the document the rule left', () => {
		expect(delivered).toContain(CANONICAL)
		expect(delivered).not.toContain('CLAUDE.md')
	})
})

// **A route stays resident; the trigger and the body do not.** joshuafolkken/kit#3395 took the
// trigger and the criterion out: an agent that runs no hook applies the delivery enumeration as a
// self-check list (`principles.md`, joshuafolkken/kit#3079), so the resident line names that
// enumeration, and the enumeration's own suite below pins that it names this topic file.
describe.each(AI_DOCS)('%s — keeps the route, not the rule', (document_path) => {
	const content = read_unwrapped(document_path)

	it("no longer carries the trigger, now at the enumeration's pointer", () => {
		expect(content).not.toContain(
			"**Put every call that does not depend on another's result in the same turn.**",
		)
	})

	it.each(["A run's wall clock is set by how many times it stops to wait for a tool"])(
		'leaves the reasoning %j at the pointer',
		(marker) => {
			expect(content).not.toContain(marker)
			expect(read_unwrapped(CANONICAL)).toContain('費用は仕事の量ではなく往復の回数にある')
		},
	)

	// The enumeration names the hook and what a turn with no trigger means, so the route is enough.
	it('routes to the delivery enumeration', () => {
		expect(content).toContain('turn batching')
		expect(content).toContain(DELIVERY)
	})

	// The measured breakdown is what makes the rule persuasive, not what makes it obeyed, so it
	// belongs at the pointer — and it is the most quotable part, so it is the first thing that would
	// be pasted back. The rule surface is searched rather than the document alone, and the residency
	// lists with it: those are the likeliest paste targets.
	it.each(MEASUREMENTS)('leaves the measurement %j at the pointer', (measurement) => {
		expect(read_unwrapped_rule_surface(document_path)).not.toContain(measurement)
		expect(read_unwrapped(RESIDENCY)).not.toContain(measurement)
		expect(read_unwrapped(CANONICAL)).not.toContain(measurement)
		expect(read_unwrapped(RATIONALE)).toContain(measurement)
	})
})

describe(`${CANONICAL} — carries the criterion and the reasoning`, () => {
	const content = read_unwrapped(CANONICAL)

	it.each([
		'# 独立した呼び出しは同じターンに載せる（joshuafolkken/kit#1304）',
		'**この呼び出しの入力は、いま出していない別の呼び出しの結果に依存しているか。**',
		'**費用は仕事の量ではなく往復の回数にある。**',
		// The half a read-only reading loses. `Edit` was the largest single item measured, so a rule
		// read as being about `grep` and `cat` leaves the biggest share untouched.
		'**`Edit` も同じ規則の対象である**',
		// And the half that keeps the saving honest — the issue's second acceptance condition.
		'**往復を減らすのは「同じ仕事を少ないターンで出す」ことであって、「仕事を減らす」ことではない。**',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Recorded so the next reader proposes something else rather than re-deriving the same dead end.
	// The first is the one that looks obviously right and is not: a hook sees one call and cannot see
	// what it depends on.
	it.each([
		'**The independence of a call cannot be observed from that one call.**',
		'**Assume a tool that bundles several edits into one call.**',
		'**Impose a minimum number of calls per turn.**',
	])('records the rejected mechanism %j', (marker) => {
		expect(read_unwrapped(RATIONALE)).toContain(marker)
	})

	it('says how the result is read back', () => {
		expect(content).toContain('Round trips:')
		expect(content).toContain('scripts/time-runtime/time-round-trips.ts')
	})
})

// joshuafolkken/kit#1452: the first rejection above read as a rejection of `PreToolUse` itself, which
// this package ships as `pnpm josh batch:guard` (joshuafolkken/kit#1390). What was rejected is
// judging independence from the single call in hand; the guard judges from closed history instead.
// **The reconciliation has to sit with the rejection**, not 30 lines below it: a reader who stops at
// the bullet meets a distributed mechanism described as impossible to build, and then reads the
// refusal it issues as unexpected behavior.
describe(`${RATIONALE} — reconciles the rejection with the shipped guard`, () => {
	const content = read_unwrapped(RATIONALE)

	// The limitation is named because the correction is about the record, not about the mechanism
	// working: #1509 is open, so a reader told only that the guard ships would read it as effective.
	it.each([
		'**What was rejected is that way of judging, not the `PreToolUse` mechanism itself.**',
		'joshuafolkken/kit#1390',
		'**closed history**',
		'joshuafolkken/kit#1509',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The exact sentence the document carried until #1452. Asserted as absent because every presence
	// marker above passes beside it — the reconciliation can be added without the false claim being
	// taken out, and that half-fix is the regression this pins.
	it('no longer calls the distributed mechanism unavailable', () => {
		expect(read_unwrapped(CANONICAL)).not.toContain(
			'**PreToolUse フックが「2 ターン連続で単発呼び出し」を拒否する。** 採れない。',
		)
	})
})

// The residency list is the second half of the rule: a rule the criterion moved and that is not
// listed as moved has not been checked against it (`residency-rationale.md`).
describe.each([RESIDENCY_RATIONALE])('%s — lists the rule as delivered', (list_path) => {
	const content = read_unwrapped(list_path)

	it('names the rule', () => {
		expect(content).toContain(TOPIC_FILE)
	})

	it('names the trigger that delivers it', () => {
		expect(content).toContain(GUARD_COMMAND)
	})

	// Recorded so the relocation cannot later read as a cull: the prose was resident and not obeyed, and
	// that measurement is the reason it moved.
	it('gives the reason it moved off residency', () => {
		expect(content).toContain('joshuafolkken/kit#1524')
	})
})

describe(`pnpm josh rule:list — the enumeration names this rule and its silent turn`, () => {
	const content = rule_list.render()

	it.each([TOPIC_FILE, GUARD_COMMAND])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('leaves the pinning suite to the rationale', () => {
		expect(read_unwrapped(RULE_DELIVERY_RATIONALE)).toContain(SUITE_PATH)
	})
})

describe(`${RESIDENCY_RATIONALE} — names the suite that pins the rule`, () => {
	it('cites this file', () => {
		expect(read_unwrapped(RESIDENCY_RATIONALE)).toContain(SUITE_PATH)
	})
})

// joshuafolkken/kit#2202: the batching guard is off in a lane child (kit#2178), so the only thing that
// can fold mid-implementation independent edits is a composite command at a pre-determined point —
// `read:files`, routed at the Step 0 seam. The command and its two documentation homes are pinned
// together so a rename cannot leave the routing pointing at a command that is gone.
describe('kit#2202 — the read:files lever is documented and routed', () => {
	const REPORT_FORMAT = `${WORKFLOW_PROMPT_DIRECTORY}/report-format.md`
	const READ_FILES_COMMAND = 'pnpm josh read:files'
	const LEVER_HEADING = '実装中の独立編集に効く合成コマンド'

	it('turn-batching.md carries the lever section and names the command', () => {
		const content = read_unwrapped(CANONICAL)

		expect(content).toContain(LEVER_HEADING)
		expect(content).toContain(READ_FILES_COMMAND)
		expect(content).toContain('joshuafolkken/kit#2202')
	})

	it('report-format.md routes the run to it at the Step 0 seam', () => {
		const content = read_unwrapped(REPORT_FORMAT)

		expect(content).toContain(READ_FILES_COMMAND)
		expect(content).toContain(LEVER_HEADING)
	})
})
