import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

if (process.env.FINAL_FORE_ORDERS_INSTALL_CHROMIUM === '1') {
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  execFileSync(process.execPath, [cli, 'install', 'chromium', '--only-shell'], { stdio: 'inherit' });
}
