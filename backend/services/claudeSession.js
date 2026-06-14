import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdirSync, openSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');
const WORKSPACE_DIR = path.join(__dirname, '..', 'ai-workspace');

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(WORKSPACE_DIR, { recursive: true });

// Tokenizes a flag string like: --allowedTools "Bash(curl:*)"
function parseFlags(raw) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(raw))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

// Strip vars from this process's own Claude Code session so the spawned
// `claude -p` falls back to the normal OAuth login instead of a stray
// API key, and isn't treated as a nested/child session.
const STRIPPED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
];

export function spawnHeadlessSession(prompt) {
  const sessionId = randomUUID();
  const logFile = path.join(LOG_DIR, `ai-session-${sessionId}.log`);
  const fd = openSync(logFile, 'a');

  const claudeBin = process.env.CLAUDE_BIN || 'claude';
  const permissionFlags = parseFlags(process.env.CLAUDE_PERMISSION_FLAGS || '');
  const args = ['-p', prompt, '--output-format', 'json', ...permissionFlags];

  const env = { ...process.env };
  for (const key of STRIPPED_ENV_VARS) delete env[key];

  const child = spawn(claudeBin, args, {
    cwd: WORKSPACE_DIR,
    env,
    detached: true,
    stdio: ['ignore', fd, fd],
  });

  child.unref();

  return { sessionId, logFile };
}
