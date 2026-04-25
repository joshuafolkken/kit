function load_optional_environment(): void {
	try {
		process.loadEnvFile('.env')
	} catch {
		// .env is optional
	}
}

export { load_optional_environment }
