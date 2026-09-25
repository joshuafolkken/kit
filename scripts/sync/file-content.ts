import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function is_absent_error(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function is_read_denied(error: unknown): boolean {
	return (
		error instanceof Error && 'code' in error && ['EACCES', 'EPERM'].includes(String(error.code))
	)
}

function is_regular_existing_file(destination_path: string): boolean {
	try {
		return lstatSync(destination_path).isFile()
	} catch (error) {
		if (is_absent_error(error)) return false
		throw error
	}
}

function does_read_match(destination_path: string, expected: Buffer): boolean {
	try {
		return readFileSync(destination_path).equals(expected)
	} catch (error) {
		if (is_read_denied(error)) return false
		throw error
	}
}

function is_same_file_content(destination_path: string, content: string | Buffer): boolean {
	if (!is_regular_existing_file(destination_path)) return false

	const expected = Buffer.isBuffer(content) ? content : Buffer.from(content)

	return does_read_match(destination_path, expected)
}

function write_text_if_changed(destination_path: string, content: string): boolean {
	if (is_same_file_content(destination_path, content)) return false

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, content)

	return true
}

export const file_content = { is_same_file_content, write_text_if_changed }
