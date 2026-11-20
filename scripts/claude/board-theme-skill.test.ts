import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

const SKILL_DIRECTORY = '.claude/skills/board-theme'
const TEMPLATE_FILE = 'demo-template.md'
const create_directory = temporary_directory()
const JS_BLOCK = /^```js\n(?<code>[\s\S]*?)^```$/gmu

function read_skill_file(name: string): string {
	return readFileSync(package_path(`${SKILL_DIRECTORY}/${name}`), 'utf8')
}

function js_blocks(markdown: string): Array<string> {
	return [...markdown.matchAll(JS_BLOCK)].map((match) => match.groups?.['code'] ?? '')
}

function node_check(code: string): number | null {
	const file = path.join(create_directory('board-theme-'), 'demo.mjs')

	writeFileSync(file, code)

	return spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }).status
}

describe('board-theme demo template', () => {
	const blocks = js_blocks(read_skill_file(TEMPLATE_FILE))

	it('holds the template in exactly one js code block', () => {
		expect(blocks).toHaveLength(1)
	})

	it('passes node --check', () => {
		expect(node_check(blocks[0] ?? '')).toBe(0)
	})
})

describe('board-theme skill', () => {
	const skill = read_skill_file('SKILL.md')

	it('is read when a theme or a theme effect is asked for', () => {
		expect(skill).toMatch(/^description: .*`run:board` theme.*effect/mu)
	})

	it.each([
		"Put the demo's code in the Issue body when filing",
		'which element takes which color',
		"leaves the existing themes'\n  look unchanged",
		"Compare the implementation's commit with the demo's code",
	])('carries the step "%s"', (step) => {
		expect(skill).toContain(step)
	})

	it.each(['#8357', '#8377', '8376#issuecomment-', '8354#issuecomment-', '#8384', TEMPLATE_FILE])(
		'links the example %s',
		(example) => {
			expect(skill).toContain(example)
		},
	)
})
