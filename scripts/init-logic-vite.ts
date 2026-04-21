const VISUALIZER_IMPORT = "import { visualizer } from 'rollup-plugin-visualizer'"
const VISUALIZER_TYPE_IMPORT = "import type { UserConfig, ConfigEnv } from 'vite'"
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

function update_bracket_depth(depth: number, char: string): number {
	if (char === '[') return depth + 1
	if (char === ']') return depth - 1

	return depth
}

function find_plugins_bracket_close(content: string, open_pos: number): number {
	let depth = 0

	for (let index = open_pos; index < content.length; index += 1) {
		depth = update_bracket_depth(depth, content.charAt(index))
		if (depth === 0) return index
	}

	return -1
}

function inject_visualizer_import(content: string): string {
	const pos = find_last_import_pos(content)

	return `${content.slice(0, pos)}${VISUALIZER_TYPE_IMPORT}\n${VISUALIZER_IMPORT}\n${content.slice(pos)}`
}

function inject_visualizer_plugin(content: string): string {
	const plugins_index = content.indexOf('plugins: [')
	if (plugins_index === -1) return content
	const open = content.indexOf('[', plugins_index)
	const close = find_plugins_bracket_close(content, open)
	if (close === -1) return content
	const inner = content.slice(open + 1, close)
	const trimmed = inner.trimEnd()
	const stripped = trimmed.replace(/,$/u, '')
	const suffix = stripped.trimStart() === '' ? VISUALIZER_PLUGINS : `, ${VISUALIZER_PLUGINS}`

	return `${content.slice(0, open + 1)}${stripped}${suffix}${inner.slice(trimmed.length)}${content.slice(close)}`
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
