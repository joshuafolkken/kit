import { describe, expect, it, vi } from 'vitest'
import { path_decision } from './path-decision'

const ANSWER = 'medium'
const REASON = 'changed paths that execute or instruct: scripts/x.ts'
const KEY = 'level'

describe('path_decision.parse_options', () => {
	it('defaults to the branch diff', () => {
		expect(path_decision.parse_options([])).toStrictEqual({ is_staged: false, is_json: false })
	})

	it('reads the staged flag', () => {
		expect(path_decision.parse_options(['--staged'])?.is_staged).toBe(true)
	})

	it('reads the json flag', () => {
		expect(path_decision.parse_options(['--json'])?.is_json).toBe(true)
	})

	// A mistyped flag that silently read the branch diff would answer a question nobody asked.
	it('refuses an unknown flag rather than ignoring it', () => {
		expect(path_decision.parse_options(['--nonsense'])).toBeUndefined()
	})
})

describe('path_decision.print_decision', () => {
	// The split is what lets `$(pnpm josh review:level)` capture the answer while a person still
	// sees the reason.
	it('puts the answer on stdout and the reason on stderr', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		path_decision.print_decision(KEY, ANSWER, REASON, false)

		expect(info).toHaveBeenCalledWith(ANSWER)
		expect(error).toHaveBeenCalledWith(REASON)

		info.mockRestore()
		error.mockRestore()
	})

	// The key is the caller's, so `review:level --json` keeps saying `level` rather than a name
	// invented by the shared helper.
	it('names the answer with the calling command own key in json form', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		path_decision.print_decision(KEY, ANSWER, REASON, true)

		expect(info).toHaveBeenCalledWith(JSON.stringify({ level: ANSWER, reason: REASON }))

		info.mockRestore()
	})
})

describe('path_decision.format_path_list', () => {
	it('lists the paths when they fit', () => {
		expect(path_decision.format_path_list(['a.ts', 'b.ts'])).toBe('a.ts, b.ts')
	})

	// A reason that printed every path of a large diff would bury the answer it exists to explain.
	it('counts the rest once the listing would run long', () => {
		const many = Array.from({ length: 7 }, (_unused, index) => `f${String(index)}.ts`)

		expect(path_decision.format_path_list(many)).toContain('+2 more')
	})

	it('says nothing for no paths', () => {
		expect(path_decision.format_path_list([])).toBe('')
	})
})

describe('path_decision.run_path_decision', () => {
	const COMMAND = {
		usage: 'Usage: josh thing [--staged]',
		key: 'answer',
		decide: (): 'yes' => 'yes',
		explain: (): string => 'because',
	}

	// The usage line is the answer to a bad invocation, and a non-zero exit is what stops a caller
	// from reading the absent stdout as a verdict.
	it('refuses an unknown flag with the usage line and a failing exit code', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await expect(path_decision.run_path_decision(['--nope'], COMMAND)).resolves.not.toBe(0)
		expect(error).toHaveBeenCalledWith(COMMAND.usage)

		error.mockRestore()
	})
})
