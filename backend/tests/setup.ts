/**
 * Test bootstrap — preloaded via bunfig.toml [test].preload.
 * Runs before any test or src/ import, so we can set required env defaults
 * before src/env.ts performs its zod-validation at module-load time.
 *
 * Uses `||=` (not `??=`) so empty-string env vars inherited from the shell
 * are overridden — common pitfall when ANTHROPIC_API_KEY is exported empty.
 */
process.env.ANTHROPIC_API_KEY ||= 'sk-ant-test-key-not-used-because-we-stub';
process.env.DATABASE_URL ||= 'postgres://accountio:accountio@localhost:5432/accountio';
process.env.UPLOAD_DIR ||= './uploads-test';
process.env.NODE_ENV = 'test';
