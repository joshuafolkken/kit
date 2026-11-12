const AT = '2026-10-30T14:00:00.000Z'
const ROOT = '/work/kit'

function command(text: string, timestamp: string = AT): string {
	return JSON.stringify({
		type: 'item.started',
		timestamp,
		item: { id: 'item_1', type: 'command_execution', command: text },
	})
}

function file(file_path: string, timestamp: string = AT): string {
	return JSON.stringify({
		type: 'item.completed',
		timestamp,
		item: { id: 'item_2', type: 'file_change', changes: [{ path: file_path, kind: 'update' }] },
	})
}

const run_board_operation_codex_fixture = { AT, ROOT, command, file }

export { run_board_operation_codex_fixture }
