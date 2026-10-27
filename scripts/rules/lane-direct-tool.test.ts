import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { core_weights } from '#scripts/gate/core-weights'
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
const JOSH_RENAME =
	"pnpm josh rename lane_ledger lane_ledger_write --import '#scripts/lane/lane-ledger' '#scripts/lane/lane-ledger-write' scripts/gate/core-wait-record.ts"
const ESLINT_FOUR = `${PNPM_EXEC_ESLINT} --concurrency 4`
const NOW_MS = 1_700_000_000_000
const A_LATER_CALL_MS = NOW_MS + 60_000
const REASON = lane_direct_tool.LANE_DIRECT_TOOL_REASON
const CORES = 8
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
		['a multi-worker eslint in a `bash` heredoc', `bash <<'EOF'\n${ESLINT_FOUR}\nEOF`],
		[
			'a reserved multi-worker eslint in an `sh` heredoc',
			`pnpm josh reserved-run 4 -- sh <<EOF\n${ESLINT_FOUR}\nEOF`,
		],
	])('fires on %s in a lane child', (_name, command) => {
		expect(lane_direct_tool.is_lane_direct_tool(command, true)).toBe(true)
	})

	it.each([
		['`--concurrency off`', `${RESERVED_ESLINT} --concurrency off`],
		['`--concurrency 1`', `${RESERVED_ESLINT} --concurrency 1`],
		['no `--concurrency`', RESERVED_ESLINT],
		['a reserved single-worker eslint in `sh -c`', `pnpm josh reserved-run 2 -- sh -c 'eslint .'`],
		['the related lint', LINT_RELATED],
		// A heredoc no shell reads is text: `cat` prints it.
		['a heavy tool in a `cat` heredoc', `cat <<'EOF' > notes.md\n${ESLINT_FOUR}\nEOF`],
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

	// joshuafolkken/kit#5236: the rename formats through the edit hook's own eslint route.
	it('lets josh rename through', () => {
		expect(delivered_rules.delivery(payload_of('lane-rename', JOSH_RENAME), NOW_MS)).toBeUndefined()
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
		['wrapped for you'],
		['every occurrence'],
	])('carries %j', (marker) => {
		expect(REASON).toContain(marker)
	})
})

// joshuafolkken/kit#5147: the reissue the refusal asked for is made by the hook.
describe('reserved_command', () => {
	it.each([
		['pnpm exec eslint scripts/a.ts', core_weights.CORE_WEIGHTS.lint],
		['pnpm tsc -p .', core_weights.CORE_WEIGHTS.type_check],
		['npx cspell scripts/a.ts', core_weights.CORE_WEIGHTS.spell_check],
		['pnpm exec vitest run --maxWorkers 3 scripts/a.test.ts', 3],
		['vitest run scripts/a.test.ts', CORES - 1],
		["sh -c 'eslint . --concurrency off'", core_weights.CORE_WEIGHTS.lint],
		['pnpm exec eslint "a b.ts" 2>&1', core_weights.CORE_WEIGHTS.lint],
		['pnpm exec eslint "a;b.ts"', core_weights.CORE_WEIGHTS.lint],
	])('wraps %j at its gate weight', (command, weight) => {
		expect(lane_direct_tool.reserved_command(command, CORES)).toBe(
			`pnpm josh reserved-run ${String(weight)} -- ${command}`,
		)
	})

	it.each([
		[ESLINT_FOUR],
		['pnpm exec eslint . --concurrency auto'],
		['pnpm exec eslint . && git status'],
		['pnpm exec vitest run | tail -5'],
		['pnpm exec eslint . > out.txt'],
		['(cd scripts && pnpm exec eslint .)'],
		['CI=1 pnpm exec vitest run'],
		['pnpm exec eslint $(git diff --name-only)'],
		['pnpm exec eslint . # lint'],
		['time pnpm exec eslint .'],
		['/usr/bin/time -p pnpm exec vitest run'],
		[LINT_RELATED],
		[JOSH_RESERVED],
		['git commit -m "run eslint"'],
	])('leaves %j unwrapped', (command) => {
		expect(lane_direct_tool.reserved_command(command, CORES)).toBeUndefined()
	})
})

describe('reserved_input', () => {
	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		process.env[lane_child_marker.KEY] = ISSUE
	})

	afterAll(() => {
		Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	})

	it('rewrites a lane child direct run, keeping the other input fields', () => {
		const input = { command: PNPM_EXEC_ESLINT, description: 'Lint' }

		expect(lane_direct_tool.reserved_input({ name: BASH, input })).toStrictEqual({
			command: `pnpm josh reserved-run ${String(core_weights.CORE_WEIGHTS.lint)} -- ${PNPM_EXEC_ESLINT}`,
			description: 'Lint',
		})
	})

	it('leaves a non-Bash call alone', () => {
		expect(
			lane_direct_tool.reserved_input({ name: 'Read', input: { command: PNPM_EXEC_ESLINT } }),
		).toBeUndefined()
	})

	it('passes the rewritten line through the refusal', () => {
		const rewritten = lane_direct_tool.reserved_input({
			name: BASH,
			input: { command: PNPM_EXEC_ESLINT },
		})

		expect(lane_direct_tool.is_lane_direct_tool(String(rewritten?.['command']), true)).toBe(false)
	})
})

describe('reserved_input — outside a lane checkout', () => {
	it('rewrites nothing', () => {
		process.chdir(WORK_DIRECTORY)
		Reflect.deleteProperty(process.env, lane_child_marker.KEY)

		expect(
			lane_direct_tool.reserved_input({ name: BASH, input: { command: PNPM_EXEC_ESLINT } }),
		).toBeUndefined()
	})
})

// realpathSync so the assertion holds on macOS, where process.cwd() resolves the /tmp symlink.
describe('cwd isolation', () => {
	it('runs the silence assertions from the non-lane work directory', () => {
		expect(process.cwd()).toBe(realpathSync(WORK_DIRECTORY))
		expect(lane_child_marker.is_child_of(process.cwd())).toBe(false)
	})
})
