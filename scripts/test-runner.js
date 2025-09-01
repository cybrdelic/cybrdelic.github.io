#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = (color, message) => console.log(`${colors[color]}${message}${colors.reset}`);

async function runCommand(command, description) {
  log('blue', `\n🚀 ${description}...`);
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout) log('green', stdout);
    if (stderr) log('yellow', stderr);
    return true;
  } catch (error) {
    log('red', `❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  log('cyan', '🎭 Cybrdelic Portfolio Test Runner');
  log('cyan', '=====================================');

  switch (command) {
    case 'install':
      await runCommand('npm install', 'Installing dependencies');
      await runCommand('npx playwright install', 'Installing Playwright browsers');
      break;

    case 'quick':
      await runCommand('npx playwright test --project=chromium', 'Running quick Chromium tests');
      break;

    case 'mobile':
      await runCommand('npx playwright test --project=mobile-chrome --project=mobile-safari', 'Running mobile tests');
      break;

    case 'desktop':
      await runCommand('npx playwright test --project=chromium --project=firefox --project=webkit', 'Running desktop tests');
      break;

    case 'ui':
      await runCommand('npx playwright test --ui', 'Opening Playwright UI');
      break;

    case 'debug':
      await runCommand('npx playwright test --debug', 'Running tests in debug mode');
      break;

    case 'report':
      await runCommand('npx playwright show-report', 'Opening test report');
      break;

    case 'perf':
      log('yellow', 'Starting dev server...');
      exec('npm run dev');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await runCommand('npm run perf-test', 'Running performance tests');
      break;

    case 'a11y':
      log('yellow', 'Starting dev server...');
      exec('npm run dev');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await runCommand('npx axe-core-cli http://localhost:3000', 'Running accessibility tests');
      break;

    case 'all':
    default:
      await runCommand('npx playwright test', 'Running all tests');
      break;
  }

  log('green', '\n✅ Test runner completed!');

  if (command === 'all' || command === 'quick') {
    log('cyan', '\nNext steps:');
    log('cyan', '• npm run test:report - View detailed results');
    log('cyan', '• npm run test:ui - Interactive test runner');
    log('cyan', '• npm run test:debug - Debug failing tests');
  }
}

main().catch(error => {
  log('red', `❌ Test runner failed: ${error.message}`);
  process.exit(1);
});
