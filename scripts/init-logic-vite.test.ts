import { describe, expect, it } from 'vitest'
import { init_logic_vite } from './init-logic-vite'

const VISUALIZER_IMPORT = "from 'rollup-plugin-visualizer'"
const VISUALIZER_ANCHOR = '// @kit:visualizer-plugins'
const PLUGINS_CONTENT = `import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
\tplugins: [sveltekit(), ${VISUALIZER_ANCHOR}],
})
`
const ALREADY_HAS_VISUALIZER = `import { visualizer } from 'rollup-plugin-visualizer'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
\tplugins: [sveltekit()],
})
`
const NO_ANCHOR_CONTENT = `import { defineConfig } from 'vite'

export default defineConfig({})
`

describe('init_logic_vite.merge_vite_config', () => {
	it('returns content unchanged when visualizer already imported', () => {
		expect(init_logic_vite.merge_vite_config(ALREADY_HAS_VISUALIZER)).toBe(ALREADY_HAS_VISUALIZER)
	})

	it('injects visualizer import and plugin when anchor is present', () => {
		const result = init_logic_vite.merge_vite_config(PLUGINS_CONTENT)

		expect(result).toContain(VISUALIZER_IMPORT)
	})

	it('returns content unchanged when anchor is not present', () => {
		expect(init_logic_vite.merge_vite_config(NO_ANCHOR_CONTENT)).toBe(NO_ANCHOR_CONTENT)
	})

	it('removes anchor from output after injection', () => {
		const result = init_logic_vite.merge_vite_config(PLUGINS_CONTENT)

		expect(result).not.toContain(VISUALIZER_ANCHOR)
	})
})
