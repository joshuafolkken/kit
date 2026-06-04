const VISUALIZER_IMPORT = "import { visualizer } from 'rollup-plugin-visualizer'"
const VISUALIZER_TYPE_IMPORT = "import type { UserConfig, ConfigEnv } from 'vite'"
const VISUALIZER_ANCHOR = '// @kit:visualizer-plugins'
const VISUALIZER_CLIENT =
	"{\n\t\t...visualizer({ open: !process.env['CI'], filename: 'stats-client.html' }),\n\t\tapply: (config: UserConfig, { command }: ConfigEnv) =>\n\t\t\tcommand === 'build' && !config.build?.ssr,\n\t}"
const VISUALIZER_SERVER =
	"{\n\t\t...visualizer({ open: !process.env['CI'], filename: 'stats-server.html' }),\n\t\tapply: (config: UserConfig, { command }: ConfigEnv) =>\n\t\t\tcommand === 'build' && !!config.build?.ssr,\n\t}"
const VISUALIZER_PLUGINS = `${VISUALIZER_CLIENT},\n\t${VISUALIZER_SERVER}`
const VISUALIZER_IMPORT_RE = /from ['"]rollup-plugin-visualizer['"]/u

function find_last_import_pos(content: string): number {
	const last_match = [...content.matchAll(/^import\s[^\n]+\n/gmu)].at(-1)
	if (last_match === undefined) return 0

	return last_match.index + last_match[0].length
}

function inject_visualizer_import(content: string): string {
	const pos = find_last_import_pos(content)

	return `${content.slice(0, pos)}${VISUALIZER_TYPE_IMPORT}\n${VISUALIZER_IMPORT}\n${content.slice(pos)}`
}

function inject_visualizer_plugin(content: string): string {
	if (!content.includes(VISUALIZER_ANCHOR)) return content

	return content.replace(VISUALIZER_ANCHOR, VISUALIZER_PLUGINS)
}

function merge_vite_config(content: string): string {
	if (VISUALIZER_IMPORT_RE.test(content)) return content
	const with_plugin = inject_visualizer_plugin(content)
	if (with_plugin === content) return content

	return inject_visualizer_import(with_plugin)
}

const init_logic_vite = {
	merge_vite_config,
}

export { init_logic_vite }
