import os from 'node:os'
import path from 'node:path'
import { file_reader } from '#scripts/lib/read-file'

const NPMRC = '.npmrc'

function read(home: string = os.homedir()): string {
	const file = path.join(home, NPMRC)

	return file_reader.read_file_or_empty(file)
}

const user_npmrc = { read }

export { user_npmrc }
