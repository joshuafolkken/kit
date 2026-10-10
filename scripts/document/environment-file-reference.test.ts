import { readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from '#scripts/josh/josh-command-types'
import { describe, expect, it } from 'vitest'
import { read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'

// The reference must name exactly the commands that load `.env`, both ways: a command that starts
// loading it without being listed fails, and so does a listed command that no longer loads it
// (joshuafolkken/kit#3601). A command loads the file one of two ways — its registry entry carries
// the `--env-file-if-exists` flag, or its script calls the loader itself, which the hooks do because
// declaring the flag would cost them in-process dispatch (`josh-commands-development.ts`).
const REFERENCE = 'docs/environment-variables.md'
// The list sits between these two sentences; the second opens the commands that do *not* load it,
// whose examples must not be counted.
const LIST_START = 'Only these load `.env` themselves'
const LIST_END = 'Every other command'
// `write_outcome` and `write_decision` are `hook-decision.ts`'s wrappers that load the file before
// running a guard, so a guard calling either loads it without naming the loader.
const LOADER_CALL = /\b(?:load_environment_file|write_outcome|write_decision)\(/u

// Each line that must name `prrun` beside the commands whose gate, chain and CI E2E steps it shares,
// found by a phrase the line opens with rather than a line number.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const CONTRACT_ANCHOR = 'This is the execution contract'
const RETIRED_CLI_NAME = 'jgame'
const CLI_DOC = 'docs/cli.md'
const PRRUN_LINES: ReadonlyArray<readonly [path: string, anchor: string]> = [
	['prompts/testing-guide.md', 'A pull request is open'],
	[WORKFLOW_SKILL, 'Before the first `pnpm josh gate` launch'],
	[WORKFLOW_SKILL, 'Before backgrounding `pnpm josh gate`'],
	[WORKFLOW_SKILL, '| E2E gate |'],
	[CHAIN_RULE, CONTRACT_ANCHOR],
	['.claude/skills/epic-commands/SKILL.md', 'The workflow keywords themselves'],
]

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function carries_flag(entry: CommandEntry): boolean {
	const flags = entry.tsx_arguments ?? []

	return OPTIONAL_ENV_FILE_FLAGS.every((flag) => flags.includes(flag))
}

function calls_loader(source: string): boolean {
	return LOADER_CALL.test(source)
}

function loads_environment_file(entry: CommandEntry): boolean {
	if (carries_flag(entry)) return true
	if (entry.script === undefined) return false

	return calls_loader(readFileSync(package_file(entry.script), 'utf8'))
}

function loading_commands(): Array<string> {
	return Object.entries(COMMAND_MAP)
		.filter(([, entry]) => loads_environment_file(entry))
		.map(([name]) => name)
		.toSorted(by_name)
}

function listed_commands(text: string): Array<string> {
	const [, after_start = ''] = text.split(LIST_START)
	const [list = ''] = after_start.split(LIST_END)

	return document_scan.command_references(list).toSorted(by_name)
}

function anchored_line(path: string, anchor: string): string {
	return (
		read_document(path)
			.split('\n')
			.find((line) => line.includes(anchor)) ?? ''
	)
}

describe('the commands that load .env', () => {
	it('are exactly the ones the reference lists', () => {
		expect(listed_commands(read_document(REFERENCE))).toStrictEqual(loading_commands())
	})

	it('are each listed once', () => {
		const listed = listed_commands(read_document(REFERENCE))

		expect(listed).toStrictEqual([...new Set(listed)])
	})

	// The comparison is only worth keeping if each side sees what it should and nothing else.
	it('reads the list and skips the commands named after it', () => {
		const text = `${LIST_START}: \`josh notify\`. ${LIST_END} — \`josh gate\`.`

		expect(listed_commands(text)).toStrictEqual(['notify'])
	})

	it('reads a loader call, direct or through a hook wrapper', () => {
		expect(calls_loader('josh_environment_file.load_environment_file()')).toBe(true)
		expect(calls_loader('hook_decision.write_outcome(raw, outcome)')).toBe(true)
	})

	it('skips a loader named without being called', () => {
		expect(calls_loader('const { load_environment_file } = hook_decision // `.env`')).toBe(false)
	})
})

describe('the lists written before prrun existed', () => {
	it.each(PRRUN_LINES)('%s names prrun on the "%s" line', (path, anchor) => {
		expect(anchored_line(path, anchor)).toContain('`prrun`')
	})
})

// `prrun` shares the chain only up to the pull request: the contract line that names it must also send
// it to its own end of the run, or step 5's `ship` reads as its instruction to merge.
describe('the chain contract names where a prrun leaves it', () => {
	it('sends prrun to its own end of the run', () => {
		const line = anchored_line(CHAIN_RULE, CONTRACT_ANCHOR)

		expect(line).toContain('`prrun.md` → "The difference — the end of the run"')
		expect(line).toContain('never issues `pnpm josh ship`')
	})
})

// `RETIRED_PHRASES` keeps the name out of the agent-read corpus; the user-facing CLI page sits outside
// that corpus, so it is read here.
describe('the retired game-kit CLI name', () => {
	it('is not used in the CLI page', () => {
		expect(read_document(CLI_DOC)).not.toContain(RETIRED_CLI_NAME)
	})
})
