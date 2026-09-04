import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm, writeFile, } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const FAST_DOWNWARD_PATH = path.resolve(process.env.FAST_DOWNWARD_PATH ?? "./fast-downward/fast-downward.py");
const FAST_DOWNWARD_ALIAS = process.env.FAST_DOWNWARD_ALIAS ?? "lama-first";
const SOLVER_TIMEOUT_MS = readPositiveDuration("FAST_DOWNWARD_TIMEOUT_MS", 30000);
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const NO_PLAN_EXIT_CODES = new Set([10, 11, 12, 13]);
function readPositiveDuration(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
/** Converts Fast Downward's IPC plan text into the agent's plan format. */
export function parseFastDownwardPlan(planText) {
    const plan = [];
    for (const rawLine of planText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(";")) {
            continue;
        }
        const closingParenthesis = line.indexOf(")");
        if (!line.startsWith("(") || closingParenthesis < 2) {
            throw new Error(`Invalid Fast Downward plan line: ${rawLine}`);
        }
        const tokens = line
            .slice(1, closingParenthesis)
            .trim()
            .split(/\s+/);
        const [action, ...args] = tokens;
        if (!action) {
            throw new Error(`Missing action in Fast Downward plan line: ${rawLine}`);
        }
        plan.push({
            parallel: false,
            action,
            args,
        });
    }
    return plan;
}
async function findPlanPath(runDirectory) {
    const planFiles = (await readdir(runDirectory))
        .filter((fileName) => fileName === "sas_plan" || /^sas_plan\.\d+$/.test(fileName))
        .sort((first, second) => {
        const firstVersion = Number(first.split(".")[1] ?? 0);
        const secondVersion = Number(second.split(".")[1] ?? 0);
        return secondVersion - firstVersion;
    });
    return planFiles[0]
        ? path.join(runDirectory, planFiles[0])
        : undefined;
}
function formatExecutionError(error) {
    const details = [error.stderr, error.stdout]
        .filter((output) => Boolean(output?.trim()))
        .map((output) => output.trim())
        .join("\n");
    return details || error.message;
}
/** Solves one PDDL problem with the locally installed Fast Downward planner. */
export default async function localSolver(pddlDomain, pddlProblem) {
    if (typeof pddlDomain !== "string" || pddlDomain.trim().length === 0) {
        throw new Error("pddlDomain must be a non-empty string");
    }
    if (typeof pddlProblem !== "string" || pddlProblem.trim().length === 0) {
        throw new Error("pddlProblem must be a non-empty string");
    }
    try {
        await access(FAST_DOWNWARD_PATH, fsConstants.X_OK);
    }
    catch {
        throw new Error(`Fast Downward is not executable at ${FAST_DOWNWARD_PATH}. `
            + "Set FAST_DOWNWARD_PATH in .env to its fast-downward.py path.");
    }
    const runDirectory = await mkdtemp(path.join(tmpdir(), "asa-fast-downward-"));
    const domainPath = path.join(runDirectory, "domain.pddl");
    const problemPath = path.join(runDirectory, "problem.pddl");
    const planPath = path.join(runDirectory, "sas_plan");
    const sasPath = path.join(runDirectory, "output.sas");
    try {
        await Promise.all([
            writeFile(domainPath, pddlDomain, "utf8"),
            writeFile(problemPath, pddlProblem, "utf8"),
        ]);
        console.log(`Running local Fast Downward (${FAST_DOWNWARD_ALIAS}) at ${FAST_DOWNWARD_PATH}`);
        let executionError;
        try {
            await execFileAsync(FAST_DOWNWARD_PATH, [
                "--alias",
                FAST_DOWNWARD_ALIAS,
                "--overall-time-limit",
                `${Math.max(1, Math.floor(SOLVER_TIMEOUT_MS / 1000))}s`,
                "--plan-file",
                planPath,
                "--sas-file",
                sasPath,
                domainPath,
                problemPath,
            ], {
                cwd: runDirectory,
                timeout: SOLVER_TIMEOUT_MS + 2000,
                maxBuffer: MAX_OUTPUT_BYTES,
                encoding: "utf8",
            });
        }
        catch (error) {
            executionError = error;
        }
        const generatedPlanPath = await findPlanPath(runDirectory);
        if (generatedPlanPath) {
            const plan = parseFastDownwardPlan(await readFile(generatedPlanPath, "utf8"));
            console.log(`Fast Downward found a plan with ${plan.length} actions`);
            return plan;
        }
        if (!executionError) {
            return undefined;
        }
        const exitCode = typeof executionError.code === "number"
            ? executionError.code
            : undefined;
        if (exitCode !== undefined && NO_PLAN_EXIT_CODES.has(exitCode)) {
            console.log(`Fast Downward found no plan (exit code ${exitCode})`);
            return undefined;
        }
        if (executionError.killed || executionError.signal) {
            throw new Error(`Fast Downward timed out after ${SOLVER_TIMEOUT_MS} ms`);
        }
        throw new Error(`Fast Downward failed${exitCode === undefined ? "" : ` with exit code ${exitCode}`}:\n`
            + formatExecutionError(executionError));
    }
    finally {
        await rm(runDirectory, { recursive: true, force: true });
    }
}
//# sourceMappingURL=onlineSolver.js.map