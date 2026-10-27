// A provider top-up is an explicit amount and purchase card, never a default.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitStatusFor } from '../../../../../dist/cli/usage.js';
import { loadTopupCardEnv, topupCard } from '../topup_common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const trajectories = join(here, '..', '..', '..');

function topupProviders() {
  return readdirSync(trajectories, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(trajectories, entry.name, 'topup.mjs')),
    )
    .map((entry) => entry.name)
    .sort();
}

export async function runTopupOrchestrator(provider, usd) {
  const allowed = topupProviders();
  if (!allowed.includes(provider))
    throw new Error(
      `unknown provider ${provider}. Allowed: ${allowed.join(', ')}`,
    );
  const dollars = Number(usd);
  if (!usd || !(dollars >= Number.MIN_VALUE) || !Number.isFinite(dollars))
    throw new Error(`usd must be an explicit amount above zero; got ${usd}`);
  if (!process.env.TOPUP_CONFIRM)
    throw new Error('TOPUP_CONFIRM is required before a purchase');
  const cardSource = loadTopupCardEnv();
  const welesEnv = join(here, '..', '..', '..', '..', '..', '.env');
  if (existsSync(welesEnv)) {
    for (const raw of readFileSync(welesEnv, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [key, ...parts] = line.split('=');
      if (!parts.length) continue;
      const value = parts
        .join('=')
        .trim()
        .replace(/^["']|["']$/g, '');
      if (key.trim() && value && !process.env[key.trim()])
        process.env[key.trim()] = value;
    }
  }
  const cardLast4 = topupCard()
    .num.match(/(\d\d\d\d)$/)
    ?.pop();
  if (!cardLast4)
    throw new Error(
      `purchase card from ${cardSource} has no usable last four digits`,
    );
  const trajectory = join(trajectories, provider, 'topup.mjs');
  console.log(
    `[orchestrator] provider=${provider} usd=$${dollars} card=****${cardLast4} source=${cardSource}`,
  );
  const child = spawn(process.execPath, [trajectory], {
    env: { ...process.env, TOPUP_USD: String(dollars) },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === null)
        reject(new Error(`${provider} top-up exited by signal ${signal}`));
      else {
        console.log(
          `[orchestrator] ${provider} top-up exited with code ${code}`,
        );
        resolve(code);
      }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , provider, usd] = process.argv;
  try {
    if (!provider)
      throw new Error(
        `Usage: node ${process.argv[1]} <${topupProviders().join('|')}> <usd>`,
      );
    process.exitCode = await runTopupOrchestrator(provider, usd);
  } catch (error) {
    console.error(`BLOCKER: ${error.message}`);
    process.exitCode = exitStatusFor(error);
  }
}
