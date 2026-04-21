const VISUALIZER_IMPORT = "import { visualizer } from 'rollup-plugin-visualizer'"
const VISUALIZER_CALL = "visualizer({ open: true, filename: 'stats.html' })"
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

	return `${content.slice(0, pos)}${VISUALIZER_IMPORT}\n${content.slice(pos)}`
}

function inject_visualizer_plugin(content: string): string {
	const plugins_index = content.indexOf('plugins: [')
	if (plugins_index === -1) return content
	const open = content.indexOf('[', plugins_index)
	const close = find_plugins_bracket_close(content, open)
	if (close === -1) return content
	const inner = content.slice(open + 1, close)
	const trimmed = inner.trimEnd()
	const suffix = trimmed.trimStart() === '' ? VISUALIZER_CALL : `, ${VISUALIZER_CALL}`

	return `${content.slice(0, open + 1)}${trimmed}${suffix}${inner.slice(trimmed.length)}${content.slice(close)}`
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
