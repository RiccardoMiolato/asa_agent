import fetch from 'node-fetch';

const HOST = process.env.PAAS_HOST || 'https://solver.planning.domains:5001';
const PATH = process.env.PAAS_PATH || '/package/dual-bfws-ffparser/solve';
const REQUEST_TIMEOUT_MS = readPositiveDuration('PDDL_REQUEST_TIMEOUT_MS', 15_000);
const SOLVER_TIMEOUT_MS = readPositiveDuration('PDDL_SOLVER_TIMEOUT_MS', 30_000);
const POLL_INTERVAL_MS = readPositiveDuration('PDDL_POLL_INTERVAL_MS', 250);

interface PlanOutput {
  sas_plan: string;
  plan: string;
}

interface SolverResult {
  stdout: string;
  call: string;
  output: PlanOutput;
}

interface JsonResponse {
  result: SolverResult;
  status: string;
}

interface SubmissionResponse {
  result: string;
}

function readPositiveDuration(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function fetchWithTimeout(
  url: string,
  options: Parameters<typeof fetch>[1],
  timeoutMilliseconds: number = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout((): void => controller.abort(), timeoutMilliseconds);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `PDDL solver request timed out after ${timeoutMilliseconds} ms: ${url}`,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDDL solver request failed: ${url}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export interface PddlPlanStep {
  parallel: boolean;
  action: string;
  args: string[];
}

/**
 * Calls the online PDDL solver service to generate a plan
 * @param pddlDomain - The PDDL domain definition
 * @param pddlProblem - The PDDL problem definition
 * @returns An array of plan steps, or undefined if no plan was found
 */
export default async function onlineSolver(
  pddlDomain: string,
  pddlProblem: string
): Promise<PddlPlanStep[] | undefined> {
  const responseCheckUrl = await postRequest(pddlDomain, pddlProblem);
  const json = await getResult(responseCheckUrl);
  const plan = await parsePlan(json);

  return plan;
}

/**
 * Posts a planning request to the solver service
 * @param pddlDomain - The PDDL domain definition
 * @param pddlProblem - The PDDL problem definition
 * @returns The URL to check for results
 */
async function postRequest(pddlDomain: string, pddlProblem: string): Promise<string> {
  if (typeof pddlDomain !== 'string') {
    throw new Error('pddlDomain is not a string');
  }

  if (typeof pddlProblem !== 'string') {
    throw new Error('pddlProblem is not a string');
  }

  console.log('POSTING planning request to', HOST + PATH);

  const res = await fetchWithTimeout(HOST + PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      domain: pddlDomain,
      problem: pddlProblem,
      number_of_plans: '1',
    }),
  });

  if (res.status !== 200) {
    throw new Error(`Error at ${HOST + PATH} ${await res.text()}`);
  }

  const json = (await res.json()) as SubmissionResponse;

  if (typeof json.result !== 'string' || json.result.length === 0) {
    console.log(res);
    throw new Error(`No value "result" from ${HOST + PATH} ` + res);
  }

  return new URL(json.result, `${HOST}/`).toString();
}

/**
 * Polls the solver service until the result is ready
 * @param responseCheckUrl - The URL to poll for results
 * @returns The solver response
 */
async function getResult(responseCheckUrl: string): Promise<JsonResponse> {
  const deadline = Date.now() + SOLVER_TIMEOUT_MS;

  while (true) {
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) {
      throw new Error(
        `PDDL solver did not finish within ${SOLVER_TIMEOUT_MS} ms: ${responseCheckUrl}`,
      );
    }

    console.log('PENDING planning result from', responseCheckUrl);

    const res = await fetchWithTimeout(responseCheckUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }, Math.min(REQUEST_TIMEOUT_MS, remainingMilliseconds));

    if (res.status !== 200) {
      throw new Error(`Received HTTP error from ${responseCheckUrl} ` + await res.text());
    }

    const json = (await res.json()) as JsonResponse & { status: string };

    if (json.status === 'PENDING') {
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    } else {
      // Result is ready, return it
      if (json.status !== 'ok') {
        console.log(json);
        throw new Error(`Invalid 'status' in response body from ${responseCheckUrl}`);
      }

      if (!json.result) {
        console.log(json);
        throw new Error(`No 'result' in response body from ${responseCheckUrl}`);
      }

      if (!('stdout' in json.result)) {
        console.log(json);
        throw new Error(`No 'result.stdout' in response from ${responseCheckUrl}`);
      }

      return json as JsonResponse;
    }
  }
}

/**
 * Parses the plan from the solver response
 * @param json - The solver response
 * @returns An array of plan steps, or undefined if no plan was found
 */
async function parsePlan(json: JsonResponse): Promise<PddlPlanStep[] | undefined> {
  let lines: (string | string[])[] = [];

  if (json.result.output.plan) {
    lines = json.result.output.plan.split('\n');
  }

  // PARSING plan from /package/dual-bfws-ffparser/solve
  if (json.result.stdout.includes(' --- OK.')) {
    console.log('Using parser for /package/dual-bfws-ffparser/solve');

    lines = (lines as string[]).map((line) =>
      line.replace('(', '').replace(')', '').split(' ')
    );
    lines = lines.slice(0, -1);
  }
  // PARSING plan from /package/delfi/solve
  else if (
    json.result.call.split(' ').includes('delfi') &&
    json.result.stdout.split('\n').includes('Solution found.')
  ) {
    console.log('Using parser for /package/delfi/solve');

    lines = (lines as string[]).map((line) =>
      line.replace('(', '').replace(')', '').split(' ')
    );
    lines = lines.slice(0, -1);
  }
  // PARSING plan from /package/enhsp-2020/solve
  else if (lines.includes('Problem Solved')) {
    console.log('Using parser for /package/enhsp-2020/solve');

    const startIndex = lines.indexOf('Problem Solved') + 1;
    const endIndex = lines.findIndex((line) =>
      typeof line === 'string' && line.includes('Plan-Length')
    );
    lines = lines.slice(startIndex, endIndex);

    lines = (lines as string[]).map((line) =>
      line.replace('(', '').replace(')', '').split(' ').slice(1)
    );
  }
  // PARSING plan from /package/optic/solve
  else if (
    json.result.call.split(' ').includes('optic') &&
    lines.includes(';;;; Solution Found')
  ) {
    console.log('Using parser for /package/optic/solve');

    const startIndex = lines.indexOf(';;;; Solution Found') + 1;
    lines = lines.slice(startIndex + 3);

    lines = (lines as string[]).map((line) =>
      line.replace('(', '').replace(')', '').split(' ').slice(1, -1)
    );
    lines = lines.slice(0, -1);
  }
  // PARSING plan from /package/lama-first/solve
  else if (
    json.result.call.split(' ').includes('lama-first') &&
    json.result.stdout.split('\n').includes('Solution found.')
  ) {
    console.log('Using parser for /package/lama-first/solve');

    lines = json.result.output.sas_plan.split(';')[0].split('\n');
    lines = (lines as string[]).map((line) =>
      line.replace('(', '').replace(')', '').split(' ')
    );
    lines = lines.slice(0, -1);
  }
  // ERROR
  else {
    console.log(json);
    console.error('Plan not found!');
    return;
  }

  const plan: PddlPlanStep[] = [];

  console.log('Plan found:');

  for (const line of lines as string[][]) {
    console.log('- ' + line);

    const action = line.shift() || '';
    const args = line;

    plan.push({
      parallel: false,
      action,
      args,
    });
  }

  return plan;
}
