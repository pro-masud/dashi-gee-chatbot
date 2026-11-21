export class LiveFirestoreWriteBlockedInTestError extends Error {
  readonly code = 'FAIL_CLOSED_LIVE_FIRESTORE_WRITE';

  constructor(operation: string) {
    super(
      `FAIL_CLOSED_LIVE_FIRESTORE_WRITE: Refusing live Firestore write (${operation}) during test run without FIRESTORE_EMULATOR_HOST, an active in-memory mock, or mocked globalThis.fetch.`
    );
    this.name = 'LiveFirestoreWriteBlockedInTestError';
  }
}

export class ProductionTestModeForbiddenError extends Error {
  readonly code = 'TEST_MODE_FORBIDDEN_IN_PRODUCTION';

  constructor() {
    super(
      'CRITICAL_MISCONFIGURATION: DESHI_GEE_TEST_MODE=1 is forbidden when NODE_ENV=production. Refusing to run in-memory/test hooks in production.'
    );
    this.name = 'ProductionTestModeForbiddenError';
  }
}

export function assertNoTestModeInProduction(): void {
  if (process.env.NODE_ENV === 'production' && process.env.DESHI_GEE_TEST_MODE === '1') {
    const err = new ProductionTestModeForbiddenError();
    console.error(`[SECURITY_FATAL] ${err.message}`);
    throw err;
  }
}

// Fail fast at module load if production accidentally enables DESHI_GEE_TEST_MODE=1.
assertNoTestModeInProduction();

export function isTestProcessRuntime(): boolean {
  assertNoTestModeInProduction();
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test-')) ||
    process.argv.some(
      (arg) =>
        arg === '--test' ||
        arg.startsWith('--test-') ||
        /(?:^|[/\\])tests[/\\].*\.test\.[cm]?[jt]sx?$/.test(arg)
    )
  );
}
