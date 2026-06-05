import ora, { type Ora } from 'ora'

const SUCCESS_ICON = '✅'

type AnimationStopFunction = (result?: string, icon?: string) => void

interface AnimationController {
	stop: AnimationStopFunction
	pause: () => void
}

function create_stop_function(spinner: Ora, message: string): AnimationStopFunction {
	return (result?: string, icon?: string) => {
		if (result === undefined) {
			spinner.stop()

			return
		}

		const symbol = (icon ?? SUCCESS_ICON).trimEnd()

		spinner.stopAndPersist({ symbol, text: `${message} ${result}` })
	}
}

function create_animation(message: string): AnimationController {
	const spinner = ora({ text: message }).start()

	return {
		stop: create_stop_function(spinner, message),
		pause: () => {
			spinner.stop()
		},
	}
}

const git_animation = {
	create_animation,
}

export { git_animation }
