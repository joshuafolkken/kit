import { json_object_schema } from '#scripts/schemas'
import strip_json_comments from 'strip-json-comments'

// Every managed JSON config kit reads (tsconfig.json, package.json, .vscode/*.json) may legally
// carry comments and trailing commas — TypeScript and VS Code both parse them as JSONC — so a plain
// `JSON.parse` would throw on files consumers hand-authored. Single-sourced here because the
// config-merge library and the init/sync merge helpers both need the exact same tolerant read.
function parse_jsonc(content: string): Record<string, unknown> {
	const stripped = strip_json_comments(content, { trailingCommas: true })

	return json_object_schema.parse(JSON.parse(stripped))
}

export { parse_jsonc }
