const UPGRADE_FLAG = '--upgrade'

function validate(version_arguments: ReadonlyArray<string>): string | undefined {
	if (
		version_arguments.length === 0 ||
		(version_arguments.length === 1 && version_arguments[0] === UPGRADE_FLAG)
	) {
		return undefined
	}

	return `Unsupported version argument: ${version_arguments.join(' ')}. Use ${UPGRADE_FLAG} to update.`
}

export const version_check_arguments = { validate }
