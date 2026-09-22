import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_switch_main } from './lane-switch-main'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2313: a dispatched lane child that runs `git switch main` fails structurally — a lane
// is a linked work tree and the primary checkout holds the default branch. This suite owns the two halves
// that decide whether the refusal fires — the command match (a plain `git switch` to a branch that is not
// the lane's own) and the "is this a dispatched lane child" read. **Both directions matter**: a row silent
// in a lane leaves the misfire where it was, and one that fires in the primary checkout would refuse the
// parent's own `git switch main`.

const BASH = 'Bash'
const RULE_ID = 'lane-switch-main'
const ISSUE = '2313'
const OWN_BRANCH = lane_paths.lane_branch(ISSUE)
const SWITCH_MAIN = 'git switch main'
const SWITCH_OWN = `git switch ${OWN_BRANCH}`
const SWITCH_CREATE = 'git switch -c feature'
const SWITCH_MAIN_AND_BACK = `git switch main && git pull && git switch ${OWN_BRANCH}`
const OWN_BRANCH_TITLE = 'says nothing about a switch to the lane own branch'
const NOW_MS = 1_700_000_000_000
const A_LATER_CALL_MS = NOW_MS + 60_000
const REASON = lane_switch_main.LANE_SWITCH_MAIN_REASON
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-switch-main-'))
// The directory vitest was launched from, restored before WORK_DIRECTORY is removed. The suite pins its
// working directory to the non-lane WORK_DIRECTORY per test to stay hermetic: the trigger reads the live
// process.cwd() to decide whether a checkout is a lane, so a run started inside a lane worktree would
// otherwise fire the refusal on every silence-expecting case (joshuafolkken/kit#1884).
const ENTRY_DIRECTORY = process.cwd()
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()

// Count of enumeration rows whose trigger fires for a command. Only this row may claim a `git switch` to
// a shared branch — `git-force` is `git push` / `git branch`, `worktree-mutation` is `git checkout --` /
// `restore` / `stash`.
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
	// Every test starts with no dispatch mark and no configured lane root, so the `.kit-lanes` pattern
	// decides what is a lane; the lane block sets the mark in its own beforeEach.
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	Reflect.deleteProperty(process.env, lane_paths.LANE_ROOT_KEY)
	process.chdir(WORK_DIRECTORY)
})

afterAll(() => {
	process.chdir(ENTRY_DIRECTORY)

	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(delivered_rules.delivery_path(RULE_ID, transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('switch_target', () => {
	it.each([
		['a plain switch', SWITCH_MAIN, 'main'],
		['a `-C <path>` prefix', 'git -C /repo switch main', 'main'],
		['the lane branch', SWITCH_OWN, OWN_BRANCH],
	])('reads the target of %s', (_name, command, target) => {
		expect(lane_switch_main.switch_target(command)).toBe(target)
	})

	it.each([
		['a non-switch', 'git pull'],
		['a create', SWITCH_CREATE],
		['a force-create', 'git switch -C feature'],
		['a detach', 'git switch --detach abc123'],
		['a bare switch', 'git switch'],
		['the previous-branch shorthand', 'git switch -'],
	])('reads no target from %s', (_name, command) => {
		expect(lane_switch_main.switch_target(command)).toBeUndefined()
	})

	// A shell line carries several commands, so both switches of a `main`-then-back sequence are read.
	it('reads every switch target on one line', () => {
		expect(lane_switch_main.switch_targets(SWITCH_MAIN_AND_BACK)).toEqual(['main', OWN_BRANCH])
	})
})

describe('is_switch_away_from_lane', () => {
	// The dispatched-child case the refusal exists for (acceptance 1).
	it('fires on `git switch main` from a dispatched lane child', () => {
		expect(lane_switch_main.is_switch_away_from_lane(SWITCH_MAIN, true, OWN_BRANCH)).toBe(true)
	})

	// **The main checkout is not a lane child, so the parent's own `git switch main` is never refused**
	// (acceptance 3).
	it('says nothing about `git switch main` outside a lane child', () => {
		expect(lane_switch_main.is_switch_away_from_lane(SWITCH_MAIN, false, OWN_BRANCH)).toBe(false)
	})

	// A lane child returning to its own branch is not the misfire.
	it(OWN_BRANCH_TITLE, () => {
		expect(lane_switch_main.is_switch_away_from_lane(SWITCH_OWN, true, OWN_BRANCH)).toBe(false)
	})

	// A create is a new branch nothing else can hold, so it never collides.
	it('says nothing about a create even in a lane child', () => {
		expect(lane_switch_main.is_switch_away_from_lane(SWITCH_CREATE, true, OWN_BRANCH)).toBe(false)
	})

	// The `main`-then-back sequence still carries the colliding `git switch main`.
	it('fires on the switch-to-main-and-back sequence from a lane child', () => {
		expect(lane_switch_main.is_switch_away_from_lane(SWITCH_MAIN_AND_BACK, true, OWN_BRANCH)).toBe(
			true,
		)
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

	// **The `git switch main` is refused before it fails** (joshuafolkken/kit#2313 acceptance 1).
	it('delivers the rule on `git switch main` from a lane child', () => {
		expect(rule_delivery(payload_of('lane-switch', SWITCH_MAIN), NOW_MS)).toBe(REASON)
	})

	// **Every occurrence, not once per run.** A child must never run this, so a second call is refused
	// again rather than let through — unlike the once-per-run `lane-park` stop.
	it('refuses `git switch main` again on a second occurrence', () => {
		const payload = payload_of('lane-switch-again', SWITCH_MAIN)

		expect(rule_delivery(payload, NOW_MS)).toBe(REASON)
		expect(rule_delivery(payload, A_LATER_CALL_MS)).toBe(REASON)
	})

	// A lane child returning to its own branch is not touched.
	it(OWN_BRANCH_TITLE, () => {
		expect(rule_delivery(payload_of('lane-own', SWITCH_OWN), NOW_MS)).toBeUndefined()
	})

	it('is claimed by exactly one rule in the enumeration', () => {
		expect(rules_claiming(SWITCH_MAIN)).toBe(1)
	})
})

describe('rule_delivery — outside a lane checkout', () => {
	// **The ordinary case is silence** (acceptance 3): the primary checkout, where the parent runs
	// `git switch main`, must never be refused for it.
	it('says nothing about `git switch main` in a checkout that is not a lane', () => {
		expect(rule_delivery(payload_of('plain-switch', SWITCH_MAIN), NOW_MS)).toBeUndefined()
	})
})

describe('LANE_SWITCH_MAIN_REASON', () => {
	it.each([
		// The next command it hands back (acceptance 2): continue on the current branch, main:merge later.
		['keep implementing on the current branch'],
		['pnpm josh main:merge'],
		// Why the call cannot succeed.
		['already used by worktree'],
		// The pointers to the procedure, never a resident document.
		['backlogrun-lanes.md'],
		['backlogrun-child.md'],
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

// realpathSync so the assertion holds on macOS, where process.cwd() resolves the /tmp symlink.
describe('cwd isolation', () => {
	it('runs the silence assertions from the non-lane work directory', () => {
		expect(process.cwd()).toBe(realpathSync(WORK_DIRECTORY))
		expect(lane_child_marker.is_child_of(process.cwd())).toBe(false)
	})
})
