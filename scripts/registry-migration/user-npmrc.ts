import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const NPMRC = '.npmrc'

function read(home: string = os.homedir()): string {
	const file = path.join(home, NPMRC)

	return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

const user_npmrc = { read }

export { user_npmrc }
