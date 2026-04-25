import { describe, expect, it } from 'vitest'
import { init_logic_vite } from './init-logic-vite'

const VISUALIZER_IMPORT = "from 'rollup-plugin-visualizer'"
const PLUGINS_CONTENT = `import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
\tplugins: [sveltekit()],
})
`
const ALREADY_HAS_VISUALIZER = `import { visualizer } from 'rollup-plugin-visualizer'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
\tplugins: [sveltekit()],
})
`
const NO_PLUGINS_CONTENT = `import { defineConfig } from 'vite'

export default defineConfig({})
`

describe('init_logic_vite.merge_vite_config', () => {
	it('returns content unchanged when visualizer already imported', () => {
		expect(init_logic_vite.merge_vite_config(ALREADY_HAS_VISUALIZER)).toBe(ALREADY_HAS_VISUALIZER)
	})

	it('injects visualizer import and plugin when plugins array is present', () => {
		const result = init_logic_vite.merge_vite_config(PLUGINS_CONTENT)

		expect(result).toContain(VISUALIZER_IMPORT)
	})

	it('returns content unchanged when no plugins array found', () => {
		expect(init_logic_vite.merge_vite_config(NO_PLUGINS_CONTENT)).toBe(NO_PLUGINS_CONTENT)
	})
})
