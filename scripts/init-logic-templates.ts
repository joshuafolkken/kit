import type { ProjectType } from './init-logic'

// Template strings below contain `export default` as generated file content, not as module exports
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

const DEFAULT_TAILWIND_STYLESHEET = './src/routes/layout.css'
const TAILWIND_STYLESHEET_PATTERN = /tailwindStylesheet"?:\s*['"]([^'"]+)['"]/u

const DEFAULT_DEV_PORT = 5173
const DEFAULT_PREVIEW_PORT = 4173
const DEV_PORT_PATTERN = /dev_port:\s*(\d+)/u
const PREVIEW_PORT_PATTERN = /preview_port:\s*(\d+)/u

const VITE_CONFIG_SVELTEKIT = `import type { UserConfig, ConfigEnv } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
\tplugins: [
\t\tsveltekit(),
\t\t{
\t\t\t...visualizer({ open: !process.env['CI'], filename: 'stats-client.html' }),
\t\t\tapply: (config: UserConfig, { command }: ConfigEnv) =>
\t\t\t\tcommand === 'build' && !config.build?.ssr,
\t\t},
\t\t{
\t\t\t...visualizer({ open: !process.env['CI'], filename: 'stats-server.html' }),
\t\t\tapply: (config: UserConfig, { command }: ConfigEnv) =>
\t\t\t\tcommand === 'build' && !!config.build?.ssr,
\t\t},
\t],
})
`

function generate_eslint_config(type: ProjectType): string {
	return type === 'sveltekit' ? ESLINT_SVELTEKIT : ESLINT_VANILLA
}

function generate_prettier_config(stylesheet: string = DEFAULT_TAILWIND_STYLESHEET): string {
	return `import { config } from '@joshuafolkken/kit/prettier'

export default {
\t...config,
\ttailwindStylesheet: '${stylesheet}',
}
`
}

function merge_prettier_config(existing: string): string {
	const match = TAILWIND_STYLESHEET_PATTERN.exec(existing)

	return generate_prettier_config(match?.[1] ?? DEFAULT_TAILWIND_STYLESHEET)
}

function generate_playwright_config(
	development_port: number = DEFAULT_DEV_PORT,
	preview_port: number = DEFAULT_PREVIEW_PORT,
): string {
	return `import { create_playwright_config } from '@joshuafolkken/kit/playwright/base'

export default create_playwright_config({
\tdev_port: ${String(development_port)},
\tpreview_port: ${String(preview_port)},
})
`
}

function merge_playwright_config(existing: string): string {
	const development_port = Number(DEV_PORT_PATTERN.exec(existing)?.[1] ?? DEFAULT_DEV_PORT)
	const preview_port = Number(PREVIEW_PORT_PATTERN.exec(existing)?.[1] ?? DEFAULT_PREVIEW_PORT)

	return generate_playwright_config(development_port, preview_port)
}

function generate_vite_config(): string {
	return VITE_CONFIG_SVELTEKIT
}

const init_logic_templates = {
	generate_eslint_config,
	generate_prettier_config,
	merge_prettier_config,
	generate_playwright_config,
	merge_playwright_config,
	generate_vite_config,
}

export { init_logic_templates }
