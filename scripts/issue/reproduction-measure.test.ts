import { describe, expect, it } from 'vitest'
import { reproduction_measure } from './reproduction-measure'

// joshuafolkken/kit#2353. The reproduction section is `command + actual output`, never prose — the
// four cases the Issue names: a command and a fenced output block present, the section missing, prose
// only, and a tilde-fenced block (the form the template uses so it need not nest a backtick fence).

const HEADING = '## 再現'
const COMMAND = '- `grep -c foo bar`'

function body_with(section_lines: ReadonlyArray<string>): string {
	return ['## 背景', '', 'なぜ必要か', '', HEADING, '', ...section_lines].join('\n')
}

describe('reproduction_measure.has_command_output', () => {
	it('accepts a backticked command with a fenced output block', () => {
		const body = body_with([COMMAND, '', '```', '0', '```'])

		expect(reproduction_measure.has_command_output(body)).toBe(true)
	})

	it('accepts a tilde-fenced output block', () => {
		const body = body_with([COMMAND, '', '~~~', '0', '~~~'])

		expect(reproduction_measure.has_command_output(body)).toBe(true)
	})

	it('rejects a section with no reproduction at all', () => {
		expect(reproduction_measure.has_command_output('## 背景\n\nなぜ必要か')).toBe(false)
	})

	it('rejects a reproduction written in prose', () => {
		const body = body_with(['grep で 0 だったことを確認した'])

		expect(reproduction_measure.has_command_output(body)).toBe(false)
	})

	it('rejects a command with no output block', () => {
		const body = body_with([COMMAND, '', '0 でした'])

		expect(reproduction_measure.has_command_output(body)).toBe(false)
	})

	it('rejects an output block with no command (only a fence)', () => {
		const body = body_with(['```', '0', '```'])

		expect(reproduction_measure.has_command_output(body)).toBe(false)
	})

	it('does not read a backticked word inside the output block as the command', () => {
		const body = body_with(['```', 'the `flag` was set', '```'])

		expect(reproduction_measure.has_command_output(body)).toBe(false)
	})
})
