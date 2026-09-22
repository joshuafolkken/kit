import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_carry_conflict } from './lane-carry-conflict'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2267: a dispatched lane child read its parent's live carry record as a competing
// run and parked its Issue unimplemented. The budget commands `run:merge` / `run:carry` are the
// parent's own, so this suite owns the two halves that decide whether the refusal fires — the command
// match (a budget command, in either spelling) and the "is this a dispatched lane child" read. **Both
// directions matter**: a row silent in a lane leaves the measured defect where it was, and one that
// speaks for a person working in a lane refuses every budget command they run.

const BASH = 'Bash'
const RULE_ID = 'lane-carry-conflict'
const ISSUE = '2267'
const MERGE_COMMAND = 'pnpm josh run:merge 2258'
const CARRY_COMMAND = 'pnpm josh run:carry --begin "backlogrun #2252" --owner 21461'
const ALIAS_MERGE_COMMAND = 'pnpm josh rmg 2258'
const CUT_COMMAND = 'pnpm josh run:cut 2258'
const NOW_MS = 1_700_000_000_000
const A_LATER_CALL_MS = NOW_MS + 60_000
const REASON = lane_carry_conflict.LANE_CARRY_CONFLICT_REASON
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-carry-conflict-'))
// The directory vitest was launched from, restored before WORK_DIRECTORY is removed. The suite pins its
// working directory to the non-lane WORK_DIRECTORY per test to stay hermetic: the trigger reads the
// live process.cwd() to decide whether a checkout is a lane, so a run started inside a lane worktree
// would otherwise fire the refusal on every silence-expecting case (joshuafolkken/kit#1884).
const ENTRY_DIRECTORY = process.cwd()
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()

// Count of enumeration rows whose trigger fires for a budget command. Only this row may — every other
// row claims a `gh` / `git` / `notify` / `gate` call, never `run:merge` / `run:carry`.
function rules_claiming(command: string): number {
	return delivered_rules.DELIVERED_RULES.filter((rule) =>
		rule.is_trigger({ name: BASH, input: { command } }),
	).length
}

function payload_of(name: string, command: string): string {
	const transcript = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(transcript, '')
	WRITTEN_TRANSCRIPTS.add(transcript)

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name: BASH,
		tool_input: { command },
	})
}

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
	// Every test starts with no dispatch mark; the lane block sets it in its own beforeEach.
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
	// **The suite pins its own working directory** (joshuafolkken/kit#1884): launched from a lane
	// worktree, the silence cases below would otherwise read as a lane and fire the refusal.
	it('runs the silence assertions from the non-lane work directory', () => {
		// realpathSync so the assertion holds on macOS, where process.cwd() resolves the /tmp symlink.
		expect(process.cwd()).toBe(realpathSync(WORK_DIRECTORY))
		expect(lane_child_marker.is_child_of(process.cwd())).toBe(false)
	})
})

describe('invokes_budget_command', () => {
	it.each([
		['run:merge', MERGE_COMMAND],
		['run:carry', CARRY_COMMAND],
		['an alias spelling', ALIAS_MERGE_COMMAND],
		['a later segment', `git switch main && ${MERGE_COMMAND}`],
	])('matches %s', (_name, command) => {
		expect(lane_carry_conflict.invokes_budget_command(command)).toBe(true)
	})

	it.each([
		['run:cut', CUT_COMMAND],
		['run:hold', 'pnpm josh run:hold 2258'],
		['a name quoted in a body', 'gh issue comment 1 --body "do not run run:merge"'],
	])('does not match %s', (_name, command) => {
		expect(lane_carry_conflict.invokes_budget_command(command)).toBe(false)
	})
})

describe('is_carry_conflict', () => {
	// The dispatched-child case the refusal exists for.
	it('fires on a budget command from a dispatched lane child', () => {
		expect(lane_carry_conflict.is_carry_conflict(MERGE_COMMAND, true)).toBe(true)
	})

	// **A person working in the lane carries no dispatch mark, so the rule stays silent for them.**
	it('says nothing about a budget command that is not a lane child', () => {
		expect(lane_carry_conflict.is_carry_conflict(MERGE_COMMAND, false)).toBe(false)
	})

	// A lane child running its own legitimate commands is not touching the parent's budget.
	it('says nothing about a non-budget command even in a lane child', () => {
		expect(lane_carry_conflict.is_carry_conflict(CUT_COMMAND, true)).toBe(false)
	})
})

describe('rule_delivery — inside a lane checkout', () => {
	const ORIGINAL_DIRECTORY = process.cwd()

	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		// A real dispatched child arrives here with the mark set; the trigger reads it from the live
		// environment, so the delivery cases below only fire once it names this lane.
		process.env[lane_child_marker.KEY] = ISSUE
	})

	afterAll(() => {
		process.chdir(ORIGINAL_DIRECTORY)
		Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	})

	// **The parent's live record is not read as a competing run** (joshuafolkken/kit#2267 acceptance):
	// the child is refused the budget command and handed the continue instruction instead of parking.
	it('delivers the rule on a budget command from a lane child', () => {
		const reason = rule_delivery(payload_of('lane-merge', MERGE_COMMAND), NOW_MS)

		expect(reason).toBe(REASON)
	})

	// **Every occurrence, not once per run.** A child must never run these, so a second budget command
	// is refused again rather than let through — unlike the once-per-run `lane-park` stop.
	it('refuses the budget command again on a second occurrence', () => {
		const payload = payload_of('lane-merge-again', MERGE_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(REASON)
		expect(rule_delivery(payload, A_LATER_CALL_MS)).toBe(REASON)
	})

	it('is claimed by exactly one rule in the enumeration', () => {
		expect(rules_claiming(MERGE_COMMAND)).toBe(1)
		expect(rules_claiming(CARRY_COMMAND)).toBe(1)
	})
})

describe('rule_delivery — outside a lane checkout', () => {
	// **The ordinary case is silence.** A person's own session, or the parent itself, runs `run:merge`
	// and must never be refused for it.
	it('says nothing about a budget command in a checkout that is not a lane', () => {
		expect(rule_delivery(payload_of('plain-merge', MERGE_COMMAND), NOW_MS)).toBeUndefined()
	})
})

describe('LANE_CARRY_CONFLICT_REASON', () => {
	it.each([
		// The mechanical branch it hands back: continue implementing, not park or ask.
		['Continue implementing this Issue'],
		['no `needs-decision`'],
		['not to a competing run'],
		// The pointers to the procedure, never a resident document.
		['.claude/skills/workflow-commands/pre-gate-cut.md'],
		['backlogrun-progress.md'],
		// It refuses every occurrence rather than standing down after one.
		['every occurrence'],
	])('carries %j', (marker) => {
		expect(REASON).toContain(marker)
	})

	// The pointer, not the resident document: this rule was never in `CLAUDE.md`, because it binds only
	// after a lane child is already running.
	it('names the topic file rather than the resident document', () => {
		expect(REASON).not.toContain('CLAUDE.md')
	})
})
