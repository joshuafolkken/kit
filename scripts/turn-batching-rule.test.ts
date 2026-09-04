import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_unwrapped,
	read_unwrapped_rule_surface,
	WORKFLOW_PROMPT_DIRECTORY,
} from './ai-document-fixture'
import { SKILL_ENTRY_FILE, SKILL_ROOT } from './skill-fixture'

// joshuafolkken/kit#1304: measured on four merged runs, a `fullrun` issued between 1.00 and 1.13 tool
// calls per round trip — independent reads and edits went out one per turn. On #1295 the 34 `Edit`
// calls and the 32 small read-only `Bash` calls executed for about 54 seconds between them while the
// 66 turns they sat in cost 600–850, so the run's floor was set by the round trips rather than by
// the work.
//
// The rule is resident because a tool call happens on any turn at all and no skill is loaded before
// one — the same reason the file-editing prohibition is. So this suite guards two things at once:
// the rule being in `CLAUDE.md` rather than on demand, and the reasoning staying at the pointer
// rather than being pasted back beside it.
const CANONICAL = `${WORKFLOW_PROMPT_DIRECTORY}/turn-batching.md`
const RESIDENCY = `${WORKFLOW_PROMPT_DIRECTORY}/residency.md`
const WORKFLOW_SKILL_ENTRY = `${SKILL_ROOT}/workflow-commands/${SKILL_ENTRY_FILE}`
const SUITE_PATH = 'scripts/turn-batching-rule.test.ts'
// The figures the issue was filed on. Quotable enough to be the first thing pasted back into an
// always-loaded document, which is what makes them the marker for "the reasoning stayed put".
const MEASUREMENTS: ReadonlyArray<string> = ['600〜850', '1.13']

// Every sentence here changes what an agent does. Drop the first and the instruction is gone; drop
// the criterion and it reads as a rule about reading, which a turn issuing one `Edit` at a time
// walks straight past; drop the last and "fewer turns" reads as permission to skip a check.
describe.each(AI_DOCS)('%s — keeps the one-turn instruction resident', (document_path) => {
	const content = read_unwrapped(document_path)

	it.each([
		"**Put every call that does not depend on another's result in the same turn.**",
		"A run's wall clock is set by how many times it stops to wait for a tool",
		"**The criterion is whether this call's input needs another call's result, not what kind of call it is**",
		'edits are covered exactly as reads are',
		'**It never authorizes weakening a verification gate or a review**',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('routes to the canonical topic file', () => {
		expect(content).toContain(`\`${CANONICAL}\``)
	})

	// A resident rule is a trigger plus a pointer. The measured breakdown is what makes the rule
	// persuasive, not what makes it obeyed, so it belongs at the pointer — and it is the most quotable
	// part, so it is the first thing that would be pasted back. The rule surface is searched rather
	// than the document alone, and the residency lists with it: those are the likeliest paste targets.
	it.each(MEASUREMENTS)('leaves the measurement %j at the pointer', (measurement) => {
		expect(read_unwrapped_rule_surface(document_path)).not.toContain(measurement)
		expect(read_unwrapped(RESIDENCY)).not.toContain(measurement)
		expect(read_unwrapped(CANONICAL)).toContain(measurement)
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
		'**呼び出しの独立性は、1 件の呼び出しからは観測できない。**',
		'複数編集を 1 呼び出しにまとめるツールを前提にする。',
		'ターンごとに件数の下限を課す。',
	])('records the rejected mechanism %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('says how the result is read back', () => {
		expect(content).toContain('Round trips:')
		expect(content).toContain('scripts/time/time-round-trips.ts')
	})
})

// The residency lists are the second half of the rule: a rule that passes the criterion and is not
// listed has not been checked against it (`residency.md`).
describe.each([RESIDENCY, WORKFLOW_SKILL_ENTRY])('%s — lists the rule as resident', (list_path) => {
	const content = read_unwrapped(list_path)

	it('names the rule', () => {
		expect(content).toContain('turn-batching.md')
	})

	it('gives the reason it cannot move to a skill', () => {
		expect(content).toContain('joshuafolkken/kit#1304')
	})
})

describe(`${RESIDENCY} — names the suite that pins the rule`, () => {
	it('cites this file', () => {
		expect(read_unwrapped(RESIDENCY)).toContain(SUITE_PATH)
	})
})
