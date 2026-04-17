#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  @i-am-ios/cli  —  iamios command-line tool
//  Commands: init, validator, status, deploy
// ════════════════════════════════════════════════════════════════════════════

import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs   from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '2.0.0';

const C = {
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};

function log(msg)  { console.log(msg); }
function info(msg) { log(`${C.cyan('ℹ')}  ${msg}`); }
function ok(msg)   { log(`${C.green('✓')}  ${msg}`); }
function err(msg)  { log(`${C.red('✗')}  ${msg}`); }

const HELP = `
${C.bold(C.cyan('iamios'))} — I-AM-IOS CLI v${VERSION}

${C.bold('Usage:')}
  iamios <command> [options]

${C.bold('Commands:')}
  init [name]           Scaffold a new I-AM-IOS project
  validator start       Start the local validator node
  validator stop        Stop the local validator node
  validator status      Check validator health
  status                Show monorepo workspace status
  build                 Build all packages
  deploy                Deploy to production (requires .env)
  --version, -v         Print version

${C.bold('Examples:')}
  iamios init my-app --template react
  iamios validator start
  iamios validator status
`;

async function cmdInit(args) {
  const name = args[0] || 'my-sovereign-app';
  const tmpl = args.find(a => a.startsWith('--template='))?.split('=')[1] || 'vanilla';
  info(`Scaffolding "${name}" with template "${tmpl}"…`);
  try {
    execSync(`node ${path.resolve(__dirname, '../../create-i-am-ios-app/index.js')} ${name} --template=${tmpl}`, { stdio: 'inherit' });
  } catch {
    // create-i-am-ios-app not found locally — try npx
    execSync(`npx create-i-am-ios-app ${name} --template=${tmpl}`, { stdio: 'inherit' });
  }
}

async function cmdValidatorStart() {
  const validatorSrc = path.resolve(__dirname, '../../../services/validator/src/index.js');
  if (!fs.existsSync(validatorSrc)) {
    err('Validator source not found at services/validator/src/index.js');
    process.exit(1);
  }
  info('Starting validator on :8080…');
  const child = spawn('node', [validatorSrc], { stdio: 'inherit', detached: false });
  child.on('exit', code => { if (code !== 0) err(`Validator exited with code ${code}`); });
  process.on('SIGINT', () => { child.kill(); process.exit(0); });
}

async function cmdValidatorStatus() {
  const endpoint = process.env.VALIDATOR_ENDPOINT || 'http://localhost:8080';
  try {
    const res  = await fetch(`${endpoint}/health`);
    const data = await res.json();
    ok(`Validator healthy at ${endpoint}`);
    log(`   height: ${data.height}, ts: ${new Date(data.ts).toISOString()}`);
  } catch {
    err(`Validator unreachable at ${endpoint}`);
    process.exit(1);
  }
}

async function cmdStatus() {
  info('Workspace status:');
  try { execSync('npm ls --workspaces --depth=0 2>&1', { stdio: 'inherit' }); }
  catch { /* non-zero exit ok — still prints useful info */ }
}

async function cmdBuild() {
  info('Building all packages…');
  execSync('npm run build --workspaces --if-present', { stdio: 'inherit' });
  ok('Build complete.');
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!cmd || cmd === '--help' || cmd === '-h') { log(HELP); return; }
  if (cmd === '--version' || cmd === '-v')      { log(VERSION); return; }

  switch (cmd) {
    case 'init':      return cmdInit(args);
    case 'build':     return cmdBuild();
    case 'status':    return cmdStatus();
    case 'validator': {
      const sub = args[0];
      if (sub === 'start')  return cmdValidatorStart();
      if (sub === 'status') return cmdValidatorStatus();
      err(`Unknown validator sub-command: ${sub}`);
      break;
    }
    default:
      err(`Unknown command: ${cmd}`);
      log(HELP);
      process.exit(1);
  }
}

main().catch(e => { err(e.message); process.exit(1); });
