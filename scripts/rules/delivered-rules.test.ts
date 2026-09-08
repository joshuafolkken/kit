import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_batch_guard } from '#scripts/time/time-batch-guard'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#1524: a rule that left residency has to *fire*, or the relocation deleted it. The
// whole point of the Issue is that prose which is never read is indistinguishable from an absent
// rule — so this suite asserts the delivery on the call that binds it, and the silence on every call
// that does not.
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'rule-guard-'))
const WIP_CAP = 'wip-cap'
const PIPED_VERIFICATION = 'piped-verification'
// Every rule's record has to be cleared, not the first one's: a stamp left behind silences the next
// case exactly as it silences the next call, and a rule added without its id here would make the
// suite pass on a delivery that had already been spent.
const RULE_IDS: ReadonlyArray<string> = [WIP_CAP, PIPED_VERIFICATION]
const NOW_MS = 1_700_000_000_000
// The shape the Issue was filed on: a gate whose failure the pipeline reports as a success.
const PIPED_GATE_COMMAND = 'pnpm josh gate 2>&1 | tail -40'
// Case names shared by the two rules' blocks, so a literal is not repeated per rule.
const LEAVES_ALONE = 'leaves %j alone'
const CARRIES = 'carries %j'
const ONCE_PER_RUN = 'delivers once per run rather than once per call'
// The shortest command that really files an Issue, reused wherever a case needs the trigger to match
// so that no case can pass on a spelling the others do not use.
const FILING_COMMAND = 'gh issue create --title "x"'
// The `gh api` spelling of the same filing, used both as a trigger case and as a collision case.
const FILING_API_COMMAND = 'gh api repos/joshuafolkken/kit/issues -f title="x" -f body="y"'
const WRITTEN_TRANSCRIPTS = new Set<string>()
const { open_turn_lines, target_turn_lines } = time_transcript_fixture

// The trigger reads the call, never the history, so an empty transcript is the honest fixture for
// every case but the collision one: it proves the decision came from the command rather than from
// anything behind it.
function transcript_for(name: string, text = ''): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, text)
	WRITTEN_TRANSCRIPTS.add(target)

	return target
}

// Three consecutive single-call turns with the third still open — the one shape `batch:guard`
// refuses, and therefore the one shape this guard has to stay quiet on.
function unbatched_text(): string {
	return [
		...target_turn_lines(0, ['a.ts']),
		...target_turn_lines(1, ['b.ts']),
		...open_turn_lines(2, ['c.ts']),
	].join('\n')
}

function payload_of(name: string, command: string, tool_name = 'Bash'): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript_for(name),
		tool_name,
		tool_input: { command },
	})
}

// Assigned rather than deleted, for the reason `batch-guard.test.ts` gives: an empty value is not one
// the disabled list recognizes, so the guard reads as on exactly as it does on a fresh machine.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) {
		for (const rule_id of RULE_IDS) {
			rmSync(delivered_rules.delivery_path(rule_id, transcript), { force: true })
		}
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

// The trigger, judged from the command alone. Both spellings a run reaches for file an Issue; the two
// below them read the same endpoint without creating anything.
describe('is_issue_filing', () => {
	it.each([
		'gh issue create --title "x" --body "y"',
		'gh issue create --repo joshuafolkken/kit -t x',
		FILING_API_COMMAND,
		'gh api repos/{owner}/{repo}/issues -f \'labels[]=epic\' -f title="x"',
	])('reads %j as a filing', (command) => {
		expect(delivered_rules.is_issue_filing(command)).toBe(true)
	})

	// **A comment endpoint is the case that decides whether this hook is worth having.** Comments are
	// far more frequent than filings, and a guard that refused them would fire on the wrong turns —
	// which `CLAUDE.md` treats as worse than no hook at all.
	it.each([
		'gh api repos/joshuafolkken/kit/issues/1524/comments --field body=@/tmp/body.md',
		'gh issue view 1524 --comments',
		'gh api repos/joshuafolkken/kit/issues --jq length',
		'gh issue list --state open --limit 100',
		'gh pr create --title "x"',
	])(LEAVES_ALONE, (command) => {
		expect(delivered_rules.is_issue_filing(command)).toBe(false)
	})
})

describe('rule_delivery — the WIP cap at the call that files', () => {
	it('delivers the rule on the call that creates an Issue', () => {
		const reason = rule_delivery(payload_of('filing', FILING_COMMAND), NOW_MS)

		expect(reason).toBe(delivered_rules.WIP_CAP_REASON)
	})

	// Each half of the rule, because dropping any one of them changes what an agent does: without the
	// count there is nothing to compare, without the refusal the cap is advisory, and without the three
	// tests the interrupt exemption is decided by judgement — the failure joshuafolkken/kit#1518 named.
	it.each([
		"count the target repository's open Issues",
		'With more than 30 open, close one first',
		'nothing honestly closable means do not file',
		'one the run is blocked by',
		'a verification answers wrongly',
		'a documented workflow cannot complete',
		'data is lost or written outside the repository',
		'`prompts/collaboration-workflow/wip-cap.md`',
	])(CARRIES, (marker) => {
		expect(delivered_rules.WIP_CAP_REASON).toContain(marker)
	})

	// A delivery that repeated would wedge the very call it asked for, so the reason has to say that
	// reissuing is the expected next move.
	it('tells the reader the call may be reissued', () => {
		expect(delivered_rules.WIP_CAP_REASON).toContain('Reissue this call once you have counted')
	})

	it(ONCE_PER_RUN, () => {
		const payload = payload_of('repeat', FILING_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})
})

// The second trigger, judged from the command alone (joshuafolkken/kit#1556). **The half that decides
// whether this hook is worth having is the second list**: narrowing a listing with `| head` is the
// ordinary way to read one, and a guard that refused those would fire on the commonest shape in the
// transcript.
describe('is_masked_verification', () => {
	it.each([
		PIPED_GATE_COMMAND,
		'pnpm josh lint:related a.ts | head -20',
		'cd /tmp/lane && pnpm josh test:unit | tail -5',
		'josh cspell:dot | grep -i error',
		// The alias is the same command, and it is derived from the command map rather than restated.
		'pnpm josh ga | tail',
		'pnpm josh gate | tail -40 | grep failed',
	])('reads %j as a masked verification', (command) => {
		expect(delivered_rules.is_masked_verification(command)).toBe(true)
	})

	it.each([
		// Read-only listings — the whole reason the trigger is scoped to pass/fail commands.
		'git log --oneline -3 | head',
		'gh issue list --state open | head -30',
		'ls -la | wc -l',
		// A verification command that keeps its own status: no pipe, the far side of a `||`, or the
		// last segment of the pipeline, whose status *is* the pipeline's.
		'pnpm josh gate 2>&1',
		'pnpm josh gate > /tmp/gate.log 2>&1',
		'pnpm josh gate || echo failed',
		'echo a.ts | xargs pnpm josh lint:related',
		// **The way out the refusal itself recommends.** Under `pipefail` the pipeline carries the
		// check's status, so refusing this would deny the sanctioned form — and, because the shared
		// shell stamps before it refuses, would spend the run's one delivery on a compliant call and
		// leave a genuinely masked one later in the run without a refusal.
		'set -o pipefail; pnpm josh gate | tail -40',
		'set -euo pipefail && pnpm josh test:unit | tail -5',
		// A command chain inside a quoted body is text: this repository's issue and comment bodies
		// quote them constantly, and the chain split walks into the middle of one.
		'gh issue comment 1556 --body "cd x && pnpm josh gate | tail で確認"',
		// The commands that print an answer rather than a verdict. Refusing these would make the rule
		// about josh rather than about verification.
		'pnpm josh eval:scope | tail -1',
		'pnpm josh review:brief | head -40',
		'pnpm josh latest:scope | tail -1',
		// A quoted command line is text, not a call — and this repository's issue bodies quote them
		// constantly.
		'git commit -m "ran pnpm josh gate | tail -40"',
	])(LEAVES_ALONE, (command) => {
		expect(delivered_rules.is_masked_verification(command)).toBe(false)
	})
})

describe('rule_delivery — the masked verification at the call that pipes it', () => {
	it('delivers the rule on the call that pipes a check', () => {
		const reason = rule_delivery(payload_of('piped', PIPED_GATE_COMMAND), NOW_MS)

		expect(reason).toBe(delivered_rules.PIPED_VERIFICATION_REASON)
	})

	// Each half changes what the reader does next: without the mechanism the refusal reads as a style
	// note, without a sanctioned way to bound the output the caller is left with the problem that put
	// the pipe there, and without the boundary the rule reads as covering every pipe.
	it.each([
		"a pipeline exits with its last command's status",
		'Run the check without the pipe',
		'redirect it to a file and read ranges from that file',
		'`set -o pipefail`',
		'never the exit code alone',
		'Read-only listings are untouched',
		'`prompts/collaboration-workflow/output-bounds.md`',
		'Reissue this call with no pipe',
	])(CARRIES, (marker) => {
		expect(delivered_rules.PIPED_VERIFICATION_REASON).toContain(marker)
	})

	it(ONCE_PER_RUN, () => {
		const payload = payload_of('piped-repeat', PIPED_GATE_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.PIPED_VERIFICATION_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})

	// The invariant `is_first_delivery` depends on, re-checked for this row as the enumeration's own
	// comment requires: a trigger the batching guard also considers would put the silent collision back.
	it('is not a call the batching guard may also refuse', () => {
		const call = { name: 'Bash', input: { command: PIPED_GATE_COMMAND } }

		expect(time_batch_guard.is_guarded_call(call)).toBe(false)
	})
})

// What happens on a turn where the trigger does not fire: nothing at all reaches stdout, which is the
// same answer the other two guards give. A hook that spoke on these calls would cost every run.
describe('rule_delivery — silent where nothing binds', () => {
	it.each([
		['a comment', 'gh api repos/joshuafolkken/kit/issues/1524/comments --field body=@/tmp/b.md'],
		['an ordinary command', 'pnpm josh gate'],
		['a listing', 'gh issue list --state open'],
	])('says nothing on %s', (label, command) => {
		expect(rule_delivery(payload_of(`quiet-${label}`, command), NOW_MS)).toBeUndefined()
	})

	// **Never wired to a write, and never answering about one** (joshuafolkken/kit#1390): Claude Code
	// denies one call of a turn and runs the rest, so a refused `Edit` leaves its siblings applied.
	it('says nothing about a write tool even when its input looks like a filing', () => {
		const payload = payload_of('write', FILING_COMMAND, 'Edit')

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})

	it('says nothing when the switch is off', () => {
		process.env[SWITCH_ENV_KEY] = 'off'

		expect(rule_delivery(payload_of('off', 'gh issue create -t x'), NOW_MS)).toBeUndefined()
	})

	it('says nothing when the payload is not a payload', () => {
		expect(rule_delivery('not json', NOW_MS)).toBeUndefined()
	})

	it('says nothing when the payload names no command at all', () => {
		expect(rule_delivery(payload_of('empty', ''), NOW_MS)).toBeUndefined()
	})
})

// **The collision that would delete a rule silently, and the invariant that prevents it.**
describe('rule_delivery — the two Bash guards never answer about the same call', () => {
	// **The collision that would delete a rule silently, and the invariant that prevents it.**
	// `pnpm josh batch:guard` is wired to `Bash` too, and the shared shell records its stamp *before*
	// returning a reason — so a call both hooks refused would lose one of the two reasons with both
	// records already written, and the losing rule could never fire again in that run. It cannot
	// happen here because the batching guard does not treat a filing call as a candidate at all. This
	// is what makes the stand-aside in `is_first_delivery` inert today rather than load-bearing, and
	// **it has to be re-checked for any row added to the enumeration**: a trigger the batching guard
	// does consider would put the collision back.
	it.each([FILING_COMMAND, FILING_API_COMMAND])(
		'is not a call the batching guard may also refuse: %j',
		(command) => {
			expect(time_batch_guard.is_guarded_call({ name: 'Bash', input: { command } })).toBe(false)
		},
	)

	// **The stand-aside cannot be exercised end to end through this rule, and that is the invariant
	// above restated.** A run whose history is the shape the batching guard refuses still gets the
	// delivery here, because the second half of that guard's own test — is this call one it may refuse
	// at all — is false for every filing call. So the assertion is the delivery *happening* on that
	// history: a fixture that stood aside would mean the invariant had broken.
	it('still delivers on a history the batching guard would otherwise refuse', () => {
		const transcript = transcript_for('collision', unbatched_text())
		const payload = JSON.stringify({
			hook_event_name: 'PreToolUse',
			transcript_path: transcript,
			tool_name: 'Bash',
			tool_input: { command: FILING_COMMAND },
		})

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
	})
})

// The enumeration is the mechanism: one row per relocated rule, and the next rule to leave residency
// costs a row rather than a second delivery path.
describe('DELIVERED_RULES — the enumeration', () => {
	it('keys every rule uniquely, so one delivery never spends another rule budget', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(new Set(ids).size).toBe(ids.length)
	})

	it.each(RULE_IDS)('names %j', (rule_id) => {
		expect(delivered_rules.DELIVERED_RULES.map((rule) => rule.id)).toContain(rule_id)
	})

	it('is on by default', () => {
		expect(delivered_rules.is_enabled()).toBe(true)
	})
})
