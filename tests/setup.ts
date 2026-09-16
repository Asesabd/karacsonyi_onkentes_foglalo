try {
  process.loadEnvFile();
} catch {
  // no .env file - environment variables are expected to be set already (CI)
}
