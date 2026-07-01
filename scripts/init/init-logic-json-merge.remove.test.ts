import { describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

const POSTINSTALL_KEY = 'postinstall'
const MARKER = 'fix-gh-packages'
const LEFTHOOK_CMD = 'lefthook install'
const FIX_GH_CMD = 'tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'

describe('init_logic_json_merge.remove_script_with_marker', () => {
	it('removes the script when its value contains the marker', () => {
		const content = JSON.stringify({
			scripts: { [POSTINSTALL_KEY]: `${LEFTHOOK_CMD} && ${FIX_GH_CMD}`, build: 'tsc' },
		})
		const result = JSON.parse(
			init_logic_json_merge.remove_script_with_marker(content, POSTINSTALL_KEY, MARKER),
		) as { scripts: Record<string, string> }

		expect(result.scripts).not.toHaveProperty(POSTINSTALL_KEY)
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
		expect(result.scripts['build']).toBe('tsc')
	})

	it('returns content unchanged when the script lacks the marker', () => {
		const content = JSON.stringify({ scripts: { [POSTINSTALL_KEY]: LEFTHOOK_CMD } })

		expect(init_logic_json_merge.remove_script_with_marker(content, POSTINSTALL_KEY, MARKER)).toBe(
			content,
		)
	})

	it('returns content unchanged when the key is absent', () => {
		const content = JSON.stringify({ scripts: { build: 'tsc' } })

		expect(init_logic_json_merge.remove_script_with_marker(content, POSTINSTALL_KEY, MARKER)).toBe(
			content,
		)
	})

	it('returns content unchanged when the scripts block is absent', () => {
		expect(init_logic_json_merge.remove_script_with_marker('{}', POSTINSTALL_KEY, MARKER)).toBe(
			'{}',
		)
	})
})
