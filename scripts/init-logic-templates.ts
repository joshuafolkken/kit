import type { ProjectType } from './init-logic'

const ESLINT_SVELTEKIT = `import { create_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'
import svelteConfig from './svelte.config.js'

export default create_sveltekit_config({
\tgitignore_path: new URL('./.gitignore', import.meta.url),
\ttsconfig_root_dir: import.meta.dirname,
\tsvelte_config: svelteConfig,
})
`

const ESLINT_VANILLA = `import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'

export default create_vanilla_config({
\tgitignore_path: new URL('./.gitignore', import.meta.url),
\ttsconfig_root_dir: import.meta.dirname,
})
`

const PRETTIER_CONFIG = `import { config } from '@joshuafolkken/kit/prettier'

export default {
\t...config,
}
`

const PLAYWRIGHT_CONFIG = `import { create_playwright_config } from '@joshuafolkken/kit/playwright/base'

export default create_playwright_config({
\tdev_port: 5173,
\tpreview_port: 4173,
})
`

function generate_eslint_config(type: ProjectType): string {
	return type === 'sveltekit' ? ESLINT_SVELTEKIT : ESLINT_VANILLA
}

function generate_prettier_config(): string {
	return PRETTIER_CONFIG
}

function generate_playwright_config(): string {
	return PLAYWRIGHT_CONFIG
}

const init_logic_templates = {
	generate_eslint_config,
	generate_prettier_config,
	generate_playwright_config,
}

export { init_logic_templates }
