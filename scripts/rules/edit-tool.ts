// The file-editing tools a `PreToolUse` row reads by name — the one place the guards share, so the
// rows that look at `Edit` / `Write` never carry their own copy of the set (joshuafolkken/kit#5284).
const EDIT = 'Edit'
const WRITE = 'Write'

const EDIT_TOOLS: ReadonlySet<string> = new Set([EDIT, WRITE])

function is_edit_tool(name: string): boolean {
	return EDIT_TOOLS.has(name)
}

// A string field of an edit tool's input (`file_path`, `content`, `old_string`, `new_string`); `''`
// when it is absent or not a string.
function string_field(input: Record<string, unknown>, key: string): string {
	const value = input[key]

	return typeof value === 'string' ? value : ''
}

const edit_tool = {
	EDIT,
	WRITE,
	is_edit_tool,
	string_field,
}

export { edit_tool }
