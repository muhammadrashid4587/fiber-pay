import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';
import { resolveRpcEndpoint } from '../lib/rpc.js';
import type { RuntimeJobEventRecord, RuntimeJobRecord } from '../lib/runtime-jobs.js';

export function createJobCommand(config: CliConfig): Command {
  const job = new Command('job').description('Runtime job management commands');

  job
    .command('list')
    .option('--state <state>', 'Filter by job state')
    .option('--type <type>', 'Filter by job type (payment|invoice|channel)')
    .option('--limit <n>', 'Limit number of jobs')
    .option('--offset <n>', 'Offset for pagination')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const query = new URLSearchParams();
      if (options.state) query.set('state', String(options.state));
      if (options.type) query.set('type', String(options.type));
      if (options.limit) query.set('limit', String(options.limit));
      if (options.offset) query.set('offset', String(options.offset));

      const response = await fetch(
        `${runtimeUrl}/jobs${query.toString() ? `?${query.toString()}` : ''}`,
      );
      if (!response.ok) {
        return handleHttpError(response, 'JOB_LIST_FAILED', json);
      }

      const payload = (await response.json()) as { jobs: RuntimeJobRecord[] };
      if (json) {
        printJsonSuccess(payload);
        return;
      }

      if (!payload.jobs.length) {
        console.log('No jobs found.');
        return;
      }

      console.log(`Jobs (${payload.jobs.length})`);
      for (const item of payload.jobs) {
        console.log(`- ${item.id}`);
        console.log(`  Type:   ${item.type}`);
        console.log(`  State:  ${item.state}`);
        if (item.idempotencyKey) console.log(`  Key:    ${item.idempotencyKey}`);
        if (typeof item.retryCount === 'number' && typeof item.maxRetries === 'number') {
          console.log(`  Retry:  ${item.retryCount}/${item.maxRetries}`);
        }
      }
    });

  job
    .command('get')
    .argument('<jobId>')
    .option('--json')
    .action(async (jobId, options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const response = await fetch(`${runtimeUrl}/jobs/${jobId}`);
      if (!response.ok) {
        return handleHttpError(response, 'JOB_GET_FAILED', json);
      }

      const payload = (await response.json()) as RuntimeJobRecord;
      if (json) {
        printJsonSuccess(payload);
        return;
      }

      console.log('Job');
      console.log(`  ID:         ${payload.id}`);
      console.log(`  Type:       ${payload.type}`);
      console.log(`  State:      ${payload.state}`);
      if (payload.idempotencyKey) console.log(`  Key:        ${payload.idempotencyKey}`);
      if (typeof payload.retryCount === 'number' && typeof payload.maxRetries === 'number') {
        console.log(`  Retry:      ${payload.retryCount}/${payload.maxRetries}`);
      }
      if (payload.error?.message) {
        console.log(`  Error:      ${payload.error.message}`);
      }
      if (payload.result) {
        console.log('  Result:');
        console.log(`    ${JSON.stringify(payload.result)}`);
      }
    });

  job
    .command('events')
    .argument('<jobId>')
    .option('--json')
    .action(async (jobId, options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const response = await fetch(`${runtimeUrl}/jobs/${jobId}/events`);
      if (!response.ok) {
        return handleHttpError(response, 'JOB_EVENTS_FAILED', json);
      }

      const payload = (await response.json()) as { events: RuntimeJobEventRecord[] };
      if (json) {
        printJsonSuccess(payload);
        return;
      }

      if (!payload.events.length) {
        console.log('No events found for job.');
        return;
      }

      console.log(`Job events (${payload.events.length})`);
      for (const event of payload.events) {
        const timestamp = new Date(event.createdAt).toISOString();
        const transition = event.toState
          ? `${event.fromState ?? '(none)'} -> ${event.toState}`
          : (event.fromState ?? '(none)');
        console.log(`- ${timestamp} ${event.eventType} (${transition})`);
      }
    });

  job
    .command('cancel')
    .argument('<jobId>')
    .option('--json')
    .action(async (jobId, options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const response = await fetch(`${runtimeUrl}/jobs/${jobId}`, { method: 'DELETE' });
      if (!response.ok) {
        return handleHttpError(response, 'JOB_CANCEL_FAILED', json);
      }

      const payload = { jobId, cancelled: true };
      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log(`Job cancelled: ${jobId}`);
      }
    });

  return job;
}

function getRuntimeUrlOrExit(config: CliConfig, json: boolean): string {
  const endpoint = resolveRpcEndpoint(config);
  if (endpoint.target !== 'runtime-proxy') {
    const message =
      'Runtime proxy is not active for the current profile/RPC URL. Start runtime first (fiber-pay runtime start --daemon).';
    if (json) {
      printJsonError({
        code: 'RUNTIME_PROXY_REQUIRED',
        message,
        recoverable: true,
        suggestion: 'Start runtime and retry the job command.',
      });
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  }
  return endpoint.url;
}

async function handleHttpError(response: Response, code: string, json: boolean): Promise<never> {
  const body = await safeJson(response);
  const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;

  if (json) {
    printJsonError({
      code,
      message,
      recoverable: response.status >= 500 || response.status === 404,
      suggestion: 'Check runtime status and job id, then retry.',
      details: {
        status: response.status,
        body,
      },
    });
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  if ('error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
  }

  if ('message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return undefined;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
