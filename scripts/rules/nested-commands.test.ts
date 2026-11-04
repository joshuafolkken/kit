import { describe, expect, it } from 'vitest'
import { nested_commands } from './nested-commands'

// joshuafolkken/kit#5999: the commands a `Bash` call runs, the nested ones included — read by
// `protected-files.ts` and `egress-guard.ts`.

const QUOTED_MENTION = "grep -c 'cat .env' notes.md"

describe('nested_commands.commands_of — the nested commands are cut out', () => {
	it.each([
		["bash -c 'cat .env'", 'cat .env'],
		['sh -c "true; cat .env"', 'cat .env'],
		['bash -lc "cat .env"', 'cat .env'],
		['bash -o errexit -c "cat .env"', 'cat .env'],
		['sh "-c" "cat .env"', 'cat .env'],
		['eval "cat .env"', 'cat .env'],
		['echo "$(cat .env)"', 'cat .env'],
		['echo `cat .env`', 'cat .env'],
		['diff <(cat .env) x', 'cat .env'],
		['tee >(cat .env)', 'cat .env'],
		['echo "$(bash -c \'cat .env\')"', 'cat .env'],
		["bash <<'EOF'\ncat .env\nEOF", 'cat .env'],
	])('reads %j as running %j', (command, nested) => {
		expect(nested_commands.commands_of(command)).toContain(nested)
	})
})

describe('nested_commands.commands_of — a plain line is its segments', () => {
	it('cuts at the separators and keeps a quoted mention whole', () => {
		expect(nested_commands.commands_of('git status && echo "a; b"')).toEqual([
			'git status',
			'echo "a; b"',
		])
	})

	it('leaves a quoted argument of a non-shell program as text', () => {
		expect(nested_commands.commands_of(QUOTED_MENTION)).toEqual([QUOTED_MENTION])
	})

	it.each([
		'bash scripts/check.sh -c "cat .env"',
		'bash scripts/check.sh -c "true; cat .env"',
		'bash -- scripts/check.sh -c "cat .env"',
		'bash -o errexit scripts/check.sh -c "cat .env"',
		'bash --rcfile "-c" scripts/check.sh "cat .env"',
	])('leaves named-script arguments as text: %j', (command) => {
		expect(nested_commands.commands_of(command)).toEqual([command])
	})
})
