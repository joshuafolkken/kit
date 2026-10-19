import { describe, expect, it } from 'vitest'
import { oracle_list_cli } from './oracle-list-cli'
import { rule_list } from './rule-list'

// joshuafolkken/kit#4184: the guard rows carry their own description, so the two listings that read
// the rule tables are pinned whole. An intended prose change updates the snapshot with `vitest -u`.

function printed_oracle_list(): string {
	const lines: Array<string> = []
	const original = console.info

	console.info = (line: unknown): void => {
		lines.push(String(line))
	}

	try {
		oracle_list_cli.print_list()
	} finally {
		console.info = original
	}

	return `${lines.join('\n')}\n`
}

describe('the rule listings', () => {
	it('renders `rule:list` unchanged', async () => {
		await expect(`${rule_list.render()}\n`).toMatchFileSnapshot('./__snapshots__/rule-list.txt')
	})

	it('prints `oracle:list` unchanged', async () => {
		await expect(printed_oracle_list()).toMatchFileSnapshot('./__snapshots__/oracle-list.txt')
	})
})
