import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_direct_tool } from './lane-direct-tool'

// joshuafolkken/kit#4357: the core budget counts only what a `josh` command reserves, so a lane agent's
// direct `eslint` / `vitest` / `cspell` / `tsc` overlaps the other lanes uncounted. **Both directions
// matter**: a row silent in a lane leaves the overload where it was, and one that fires outside a lane
// would take an interactive session's direct runs away.

const BASH = 'Bash'
const RULE_ID = 'lane-direct-tool'
const ISSUE = '4357'
const PNPM_EXEC_ESLINT = 'pnpm exec eslint .'
const LINT_RELATED = 'pnpm josh lint:related'
const JOSH_RESERVED = 'pnpm josh reserved-run 1 -- vitest run'
const RESERVED_ESLINT = `pnpm josh reserved-run 4 -- ${PNPM_EXEC_ESLINT}`
const ESLINT_FOUR = `${PNPM_EXEC_ESLINT} --concurrency 4`
const NOW_MS = 1_700_000_000_000
const A_LATER_CALL_MS = NOW_MS + 60_000
const REASON = lane_direct_tool.LANE_DIRECT_TOOL_REASON
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-direct-tool-'))
// The suite pins its working directory to the non-lane WORK_DIRECTORY per test: the trigger reads the
// live process.cwd(), so a run started inside a lane worktree would otherwise fire on every silence case.
const ENTRY_DIRECTORY = process.cwd()
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()

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
	process.env[delivered_rules.SWITCH_ENV_KEY] = ''
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

describe('runs_heavy_tool', () => {
	it.each([
		['`pnpm exec`', PNPM_EXEC_ESLINT],
		['`npx`', 'npx vitest run'],
		['a bare tool', 'cspell "**/*.md"'],
		['`pnpm <tool>`', 'pnpm tsc --noEmit'],
		['an env prefix', 'CI=1 vitest run'],
		['a later segment', 'cd scripts && eslint rules'],
		['a piped segment', 'git diff --name-only | xargs echo && tsc -p .'],
		['a `.bin` path', 'node_modules/.bin/eslint .'],
		// joshuafolkken/kit#4356: the timed spelling that slipped through.
		['a `time -p` prefix', '/usr/bin/time -p pnpm exec eslint .'],
		['a `time -f <format>` prefix', '/usr/bin/time -f %e pnpm exec eslint .'],
	])('matches %s', (_name, command) => {
		expect(lane_direct_tool.runs_heavy_tool(command)).toBe(true)
	})

	it.each([
		['a josh check', LINT_RELATED],
		['the budgeted wrapper', JOSH_RESERVED],
		['a quoted tool name', 'git commit -m "run eslint and vitest"'],
		['a quoted shell runner', 'git commit -m "fix sh -c eslint"'],
		['another `npx` program', 'npx tsx scripts/josh/josh.ts'],
		['an unrelated command', 'git status'],
	])('does not match %s', (_name, command) => {
		expect(lane_direct_tool.runs_heavy_tool(command)).toBe(false)
	})
})

describe('is_lane_direct_tool', () => {
	it('fires on a direct tool from a dispatched lane child', () => {
		expect(lane_direct_tool.is_lane_direct_tool(PNPM_EXEC_ESLINT, true)).toBe(true)
	})

	// **An interactive session outside a lane keeps its direct runs** (acceptance 3).
	it('says nothing about a direct tool outside a lane child', () => {
		expect(lane_direct_tool.is_lane_direct_tool(PNPM_EXEC_ESLINT, false)).toBe(false)
	})

	it('says nothing about the budgeted wrapper in a lane child', () => {
		expect(lane_direct_tool.is_lane_direct_tool(JOSH_RESERVED, true)).toBe(false)
	})
})

// joshuafolkken/kit#4582: a four-worker typed eslint held 12 GB through `reserved-run` and `sh -c`.
describe('is_lane_direct_tool — multi-worker eslint and shell scripts', () => {
	it.each([
		['a reserved four-worker eslint', `${RESERVED_ESLINT} --concurrency 4`],
		['a reserved `auto` eslint', `${RESERVED_ESLINT} --concurrency auto`],
		['a reserved `=4` eslint', `${RESERVED_ESLINT} --concurrency=4`],
		['a reserved eslint in `sh -c`', `pnpm josh reserved-run 4 -- sh -c '${ESLINT_FOUR}'`],
		['a multi-worker eslint in `sh -c`', `sh -c 'cd x && ${ESLINT_FOUR}'`],
		['a direct tool in `sh -c`', `sh -c '${PNPM_EXEC_ESLINT}'`],
		['a direct tool in `bash -c`', 'bash -c "npx vitest run"'],
	])('fires on %s in a lane child', (_name, command) => {
		expect(lane_direct_tool.is_lane_direct_tool(command, true)).toBe(true)
	})

	it.each([
		['`--concurrency off`', `${RESERVED_ESLINT} --concurrency off`],
		['`--concurrency 1`', `${RESERVED_ESLINT} --concurrency 1`],
		['no `--concurrency`', RESERVED_ESLINT],
		['a reserved single-worker eslint in `sh -c`', `pnpm josh reserved-run 2 -- sh -c 'eslint .'`],
		['the related lint', LINT_RELATED],
	])('says nothing about %s in a lane child', (_name, command) => {
		expect(lane_direct_tool.is_lane_direct_tool(command, true)).toBe(false)
	})

	it.each([[`sh -c '${PNPM_EXEC_ESLINT}'`], [`${RESERVED_ESLINT} --concurrency 4`]])(
		'says nothing about `%s` outside a lane child',
		(command) => {
			expect(lane_direct_tool.is_lane_direct_tool(command, false)).toBe(false)
		},
	)
})

describe('delivered_rules.delivery — inside a lane checkout', () => {
	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		process.env[lane_child_marker.KEY] = ISSUE
	})

	afterAll(() => {
		Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	})

	// **The direct run is refused before it starts** (acceptance 2), on every occurrence.
	it('refuses a direct tool on every occurrence', () => {
		const payload = payload_of('lane-direct', PNPM_EXEC_ESLINT)

		expect(delivered_rules.delivery(payload, NOW_MS)).toBe(REASON)
		expect(delivered_rules.delivery(payload, A_LATER_CALL_MS)).toBe(REASON)
	})

	it('lets the budgeted wrapper through', () => {
		expect(
			delivered_rules.delivery(payload_of('lane-reserved', JOSH_RESERVED), NOW_MS),
		).toBeUndefined()
	})

	it('is claimed by exactly one rule in the enumeration', () => {
		expect(rules_claiming(PNPM_EXEC_ESLINT)).toBe(1)
	})
})

describe('delivered_rules.delivery — outside a lane checkout', () => {
	it('says nothing about a direct tool in a checkout that is not a lane', () => {
		expect(
			delivered_rules.delivery(payload_of('plain-direct', PNPM_EXEC_ESLINT), NOW_MS),
		).toBeUndefined()
	})
})

describe('LANE_DIRECT_TOOL_REASON', () => {
	it.each([
		[LINT_RELATED],
		['pnpm josh test:related'],
		['pnpm josh cspell:dot'],
		['pnpm josh reserved-run <weight> -- <command>'],
		['every occurrence'],
	])('carries %j', (marker) => {
		expect(REASON).toContain(marker)
	})
})

// realpathSync so the assertion holds on macOS, where process.cwd() resolves the /tmp symlink.
describe('cwd isolation', () => {
	it('runs the silence assertions from the non-lane work directory', () => {
		expect(process.cwd()).toBe(realpathSync(WORK_DIRECTORY))
		expect(lane_child_marker.is_child_of(process.cwd())).toBe(false)
	})
})
