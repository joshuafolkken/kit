import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sonar_file } from './sonar-file'

const TEST_DIR = path.join(tmpdir(), 'sonar-file-test')
const SRC_PATH = path.join(TEST_DIR, 'src', 'template.properties')
const SONAR_DEST_NAME = 'sonar-project.properties'
const DEST_PATH = path.join(TEST_DIR, 'dest', SONAR_DEST_NAME)
const SONAR_TEMPLATE = 'sonar.projectKey={{PROJECT_KEY}}\nsonar.organization={{ORGANIZATION}}\n'
const IDENTIFIERS_A = { project_key: 'myorg_myrepo', organization: 'myorg' }
const IDENTIFIERS_B = { project_key: 'a_b', organization: 'a' }
const IDENTIFIERS_C = { project_key: 'new_repo', organization: 'new' }
const IDENTIFIERS_D = { project_key: 'org_repo', organization: 'org' }

beforeEach(() => {
	mkdirSync(path.join(TEST_DIR, 'src'), { recursive: true })
	mkdirSync(path.join(TEST_DIR, 'dest'), { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('sonar_file.write_sonar_file — substitution', () => {
	it('writes substituted content to destination', () => {
		writeFileSync(SRC_PATH, SONAR_TEMPLATE)
		sonar_file.write_sonar_file(SRC_PATH, DEST_PATH, IDENTIFIERS_A)

		expect(readFileSync(DEST_PATH, 'utf8')).toBe(
			'sonar.projectKey=myorg_myrepo\nsonar.organization=myorg\n',
		)
	})

	it('replaces only PROJECT_KEY and ORGANIZATION placeholders', () => {
		const template = `${SONAR_TEMPLATE}sonar.exclusions=.claude/**\n`

		writeFileSync(SRC_PATH, template)
		sonar_file.write_sonar_file(SRC_PATH, DEST_PATH, IDENTIFIERS_B)

		expect(readFileSync(DEST_PATH, 'utf8')).toContain('sonar.exclusions=.claude/**')
	})

	it('overwrites existing destination file', () => {
		writeFileSync(DEST_PATH, 'old content\n')
		writeFileSync(SRC_PATH, SONAR_TEMPLATE)
		sonar_file.write_sonar_file(SRC_PATH, DEST_PATH, IDENTIFIERS_C)

		expect(readFileSync(DEST_PATH, 'utf8')).toContain('sonar.projectKey=new_repo')
	})
})

describe('sonar_file.write_sonar_file — directory creation', () => {
	it('creates destination directory when it does not exist', () => {
		const nested = path.join(TEST_DIR, 'nested', 'dir', SONAR_DEST_NAME)

		writeFileSync(SRC_PATH, SONAR_TEMPLATE)
		sonar_file.write_sonar_file(SRC_PATH, nested, IDENTIFIERS_D)

		expect(existsSync(nested)).toBe(true)
	})

	it('creates destination file at given path', () => {
		writeFileSync(SRC_PATH, SONAR_TEMPLATE)
		sonar_file.write_sonar_file(SRC_PATH, DEST_PATH, IDENTIFIERS_D)

		expect(existsSync(DEST_PATH)).toBe(true)
	})
})
