import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { run_stage, type StageCommand } from './run-stage'

// The stage table and the `Next:` lines are prose copies of `run_stage` (joshuafolkken/kit#3042), so a
// change to the ladder fails here until every document that quotes it is updated with it.

const SKILL_DIRECTORY = '.claude/skills/workflow-commands'
const SKILL = path.join(SKILL_DIRECTORY, 'SKILL.md')
const HOW_TO = 'docs/how-to/run-issues.md'
const TABLE_HEADER = '| Issue state'
const SEPARATOR_ROW = /^\|[\s|:-]+\|$/u
const PLACEHOLDER = '<N>'

function read(file: string): string {
	return readFileSync(path.join(process.cwd(), file), 'utf8')
}

function cells(line: string): ReadonlyArray<string> {
	return line
		.slice(1, -1)
		.split('|')
		.map((cell) => cell.trim())
}

// The stage table's rows, header first, separator dropped — the shape `run_stage.table_rows` returns.
function stage_table(file: string): ReadonlyArray<ReadonlyArray<string>> {
	const lines = read(file).split('\n')
	const start = lines.findIndex((line) => line.startsWith(TABLE_HEADER))
	const end = lines.findIndex((line, index) => index > start && !line.startsWith('|'))
	const rows = lines.slice(start, end).filter((line) => !SEPARATOR_ROW.test(line))

	return rows.map((line) => cells(line))
}

function unwrapped(file: string): string {
	return read(file).replaceAll(/\s+/gu, ' ')
}

describe('the stage table matches run_stage', () => {
	it('docs/how-to/run-issues.md carries the table run:entry decides from', () => {
		expect(stage_table(HOW_TO)).toStrictEqual(run_stage.table_rows())
	})

	it('the skill points at that table rather than carrying a second copy', () => {
		expect(unwrapped(SKILL)).toContain(`Table: \`${HOW_TO}\``)
		expect(read(SKILL)).not.toContain(TABLE_HEADER)
	})
})

describe('every stop names the commands further up the ladder', () => {
	const STOPS: ReadonlyArray<StageCommand> = ['kickoff', 'halfrun', 'prrun']

	it.each(STOPS)('%s.md quotes its Next line', (command) => {
		const line = run_stage.next_line(command, PLACEHOLDER)

		expect(unwrapped(path.join(SKILL_DIRECTORY, `${command}.md`))).toContain(line)
	})
})
