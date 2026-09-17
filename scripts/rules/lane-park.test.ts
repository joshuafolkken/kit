import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_park } from './lane-park'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2034: a dispatched lane child that stopped for a decision left no question on the
// Issue, so this suite owns the two halves that decide whether the refusal fires — the command match
// (a `confirmation` notify) and the "is this a dispatched lane child" read. **Both directions matter**:
// a row silent in a lane leaves the measured defect where it was, and one that speaks for a person
// working in a lane refuses every stop they make.

const BASH = 'Bash'
const RULE_ID = 'lane-park'
const ISSUE = '2034'
const CONFIRMATION_NOTIFY = `pnpm josh notify --task-type confirmation --issue-url https://x/${ISSUE} --body-file /tmp/b.md`
// The alias `nf` and the `--task-type=confirmation` spelling are the same call.
const CONFIRMATION_ALIAS = 'pnpm josh nf --task-type=confirmation --body-file /tmp/b.md'
// A notification that is not a stop: progress reports and PR notices never park anything.
const PROGRESS_NOTIFY = 'pnpm josh notify --task-type progress --body-file /tmp/b.md'
const APPLY_PARK = `gh api repos/o/r/issues/${ISSUE}/labels -f 'labels[]=needs-decision'`
const APPLY_PARK_EDIT = `gh issue edit ${ISSUE} --add-label needs-decision`
const NOW_MS = 1_700_000_000_000
const SAYS_NOTHING = 'says nothing about %j'
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-park-'))
// The directory vitest was launched from, restored before WORK_DIRECTORY is removed. The suite pins its
// working directory to the non-lane WORK_DIRECTORY per test to stay hermetic: the trigger reads the
// live process.cwd() to decide whether a checkout is a lane, so a run started inside a lane worktree
// would otherwise fire the refusal on every silence-expecting case (joshuafolkken/kit#1884).
const ENTRY_DIRECTORY = process.cwd()
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()

function rules_claiming(command: string): number {
	return delivered_rules.DELIVERED_RULES.filter((rule) =>
		rule.is_trigger({ name: BASH, input: { command } }),
	).length
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

describe('is_confirmation_notify', () => {
	it.each([
		[CONFIRMATION_NOTIFY],
		[CONFIRMATION_ALIAS],
		// A chain: the notify is one segment of it, and each segment is judged on its own.
		[`git status && ${CONFIRMATION_NOTIFY}`],
	])('reads %j as a confirmation stop', (command) => {
		expect(lane_park.is_confirmation_notify(command)).toBe(true)
	})

	it.each([
		[PROGRESS_NOTIFY],
		['pnpm josh notify --body-file /tmp/b.md'],
		// **The word is not the flag.** A body that mentions confirmation is not a confirmation stop.
		['pnpm josh git -y "Confirmation stop for #2034"'],
	])(SAYS_NOTHING, (command) => {
		expect(lane_park.is_confirmation_notify(command)).toBe(false)
	})
})

describe('is_unparked_stop', () => {
	// The dispatched-child case the refusal exists for.
	it('fires on a confirmation stop from a dispatched lane child', () => {
		expect(lane_park.is_unparked_stop(CONFIRMATION_NOTIFY, true)).toBe(true)
	})

	// **A person working in the lane carries no dispatch mark, so the rule stays silent for them.**
	it('says nothing about a confirmation stop that is not a lane child', () => {
		expect(lane_park.is_unparked_stop(CONFIRMATION_NOTIFY, false)).toBe(false)
	})

	// A lane child running any other command is not stopping.
	it('says nothing about a non-stop command even in a lane child', () => {
		expect(lane_park.is_unparked_stop(PROGRESS_NOTIFY, true)).toBe(false)
	})
})

describe('records_the_park', () => {
	it.each([[APPLY_PARK], [APPLY_PARK_EDIT]])('reads %j as recording the park', (command) => {
		expect(lane_park.records_the_park(command)).toBe(true)
	})

	// A different label is not the park, and a comment alone records nothing the parent reads as parked.
	it.each([
		[`gh api repos/o/r/issues/${ISSUE}/labels -f 'labels[]=in-progress'`],
		[`gh api repos/o/r/issues/${ISSUE}/comments --field body=@/tmp/b.md`],
	])(SAYS_NOTHING, (command) => {
		expect(lane_park.records_the_park(command)).toBe(false)
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

	it('delivers the rule on a confirmation stop that has not parked', () => {
		const reason = rule_delivery(payload_of('lane-park-stop', CONFIRMATION_NOTIFY), NOW_MS)

		expect(reason).toBe(delivered_rules.LANE_PARK_REASON)
	})

	// **Once per run, so obeying can never wedge the run.** The child records the park and reissues the
	// same notify; a row that refused every time would block the stop it just asked the child to record.
	it('says nothing on the reissued stop', () => {
		const payload = payload_of('lane-park-once', CONFIRMATION_NOTIFY)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.LANE_PARK_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})

	it('says nothing about a progress notification, which is not a stop', () => {
		expect(rule_delivery(payload_of('lane-park-progress', PROGRESS_NOTIFY), NOW_MS)).toBeUndefined()
	})

	it('is claimed by exactly one rule in the enumeration', () => {
		expect(rules_claiming(CONFIRMATION_NOTIFY)).toBe(1)
	})
})

describe('rule_delivery — outside a lane checkout', () => {
	// **The ordinary case is silence.** A person's own `fullrun`, in the main checkout, sends the same
	// confirmation Telegram when it stops and must never be refused for it.
	it('says nothing about a confirmation stop in a checkout that is not a lane', () => {
		expect(
			rule_delivery(payload_of('lane-park-plain', CONFIRMATION_NOTIFY), NOW_MS),
		).toBeUndefined()
	})

	it('says nothing about a write tool whose input looks like a stop', () => {
		const payload = payload_of('lane-park-write', CONFIRMATION_NOTIFY, 'Edit')

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})
})

describe('LANE_PARK_REASON', () => {
	it.each([
		// The park it asks for, and the commands that record it — the only thing that makes it actionable.
		['needs-decision'],
		["-f 'labels[]=needs-decision'"],
		// The other stops that already carry their label, so the child is not sent to add a second one.
		['needs-human-review'],
		// The pointer, and the reissue sentence every delivery needs.
		['.claude/skills/workflow-commands/pre-gate-cut.md'],
		['once per run'],
	])('carries %j', (marker) => {
		expect(delivered_rules.LANE_PARK_REASON).toContain(marker)
	})
})
