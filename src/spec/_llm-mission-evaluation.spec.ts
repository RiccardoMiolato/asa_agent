import "dotenv/config";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test, { type TestContext } from "node:test";
import { MISSION_CLASSIFICATION_INSTRUCTIONS } from "../llm/instructions/instruction.js";
import { LEVEL_1_EVALUATION_INSTRUCTIONS } from "../llm/instructions/level_1.js";
import { LEVEL_2_EVALUATION_INSTRUCTION } from "../llm/instructions/level_2.js";
import { LEVEL_3_EVALUATION_INSTRUCTION } from "../llm/instructions/level_3.js";
import { LLMClient, type LLMMessage } from "../llm/LLMClient.js";
import type { MissionLevel } from "../llm/mission.js";

type MissionToolName =
    | "math_eval"
    | "move_to"
    | "drop_at"
    | "answer_trivia"
    | "get_agent_position"
    | "get_extreme_tile"
    | "stack_constraint"
    | "delivery_constraint"
    | "parcel_constraint"
    | "avoid_cell"
    | "plan_rendezvous"
    | "plan_grid_formation"
    | "plan_parcel_handoff";

/** One held-out paraphrase derived from an example in the production prompts. */
interface MissionEvaluationCase {
    readonly id: string;
    readonly sourceExample: string;
    readonly message: string;
    readonly expectedLevel: MissionLevel;
    readonly expectedRequiresAnswer: boolean;
    readonly expectedTools: readonly MissionToolName[];
}

/** Strict classification contract requested by the production prompt. */
interface MissionClassificationResponse {
    readonly level: MissionLevel;
    readonly worth: boolean;
    readonly requires_answer: boolean;
}

/** Minimal tool-call contract needed to evaluate ordered tool selection. */
interface MissionToolCall {
    readonly name: string;
    readonly params: readonly unknown[];
}

/** Strict planning contract shared by all three level-specific prompts. */
interface MissionToolPlanningResponse {
    readonly tools: readonly MissionToolCall[];
}

/** A parse result preserves invalid model output as a measured failure. */
interface EvaluationParseResult<T> {
    readonly value: T | undefined;
    readonly error: string | undefined;
}

/** Complete observation for one case in one repeated trial. */
interface MissionEvaluationObservation {
    readonly run: number;
    readonly caseId: string;
    readonly sourceExample: string;
    readonly message: string;
    readonly expectedLevel: MissionLevel;
    readonly actualLevel: MissionLevel | undefined;
    readonly expectedRequiresAnswer: boolean;
    readonly actualRequiresAnswer: boolean | undefined;
    readonly expectedTools: readonly MissionToolName[];
    readonly actualTools: readonly string[] | undefined;
    readonly classificationCorrect: boolean;
    readonly answerFlagCorrect: boolean;
    readonly toolSelectionCorrect: boolean;
    readonly endToEndCorrect: boolean;
    readonly classificationRaw: string;
    readonly planningRaw: string;
    readonly classificationParseError: string | undefined;
    readonly planningParseError: string | undefined;
}

/** Aggregate accuracy counters for a whole experiment or one mission level. */
interface MissionEvaluationMetrics {
    readonly observations: number;
    readonly classificationCorrect: number;
    readonly classificationAccuracy: number;
    readonly answerFlagCorrect: number;
    readonly answerFlagAccuracy: number;
    readonly toolSelectionCorrect: number;
    readonly toolSelectionAccuracy: number;
    readonly endToEndCorrect: number;
    readonly endToEndAccuracy: number;
}

/** Per-level metrics make the artifact directly usable in the report. */
interface MissionLevelMetrics {
    readonly level: MissionLevel;
    readonly metrics: MissionEvaluationMetrics;
}

/** Reproducible, machine-readable artifact emitted after an evaluation run. */
interface MissionEvaluationReport {
    readonly schemaVersion: 1;
    readonly generatedAt: string;
    readonly model: string;
    readonly repetitions: number;
    readonly variantsPerRepetition: number;
    readonly overall: MissionEvaluationMetrics;
    readonly byLevel: readonly MissionLevelMetrics[];
    readonly observations: readonly MissionEvaluationObservation[];
}

const MISSION_EVALUATION_CASES: readonly MissionEvaluationCase[] = [
    {
        id: "level-1-arithmetic",
        sourceExample: "Calculate 5*5",
        message: "What is the result of (12 + 6) / 3?",
        expectedLevel: 1,
        expectedRequiresAnswer: true,
        expectedTools: ["math_eval"],
    },
    {
        id: "level-1-chained-arithmetic",
        sourceExample: "Compute 10*4+3 and subtract 2 to it",
        message: "Evaluate 7 * 8, take 5 away from it, and tell me the result.",
        expectedLevel: 1,
        expectedRequiresAnswer: true,
        expectedTools: ["math_eval"],
    },
    {
        id: "level-1-trivia",
        sourceExample: "What is the capital of Italy?",
        message: "Name the capital city of Portugal.",
        expectedLevel: 1,
        expectedRequiresAnswer: true,
        expectedTools: ["answer_trivia"],
    },
    {
        id: "level-1-current-position",
        sourceExample: "Where are you?",
        message: "Tell me your current map coordinates.",
        expectedLevel: 1,
        expectedRequiresAnswer: true,
        expectedTools: ["get_agent_position"],
    },
    {
        id: "level-1-rewarded-move",
        sourceExample: "Move to coordinate (4,7) and you get +10pts",
        message: "Travel to tile (6,9) to collect a 12 point bonus.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["move_to"],
    },
    {
        id: "level-1-penalized-move",
        sourceExample: "Navigate to coordinate x=4, y=7 and you get -5pts",
        message: "Go to x=3, y=11; doing so costs you 4 points.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["move_to"],
    },
    {
        id: "level-1-rewarded-drop",
        sourceExample: "Drop at coordinate (11, 16) and you get +10pts",
        message: "Leave a parcel at (7,13) to earn 18 points.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["drop_at"],
    },
    {
        id: "level-1-penalized-drop",
        sourceExample: "Move to (10, 5) and release packets to get -20pts",
        message: "Carry a parcel to tile (12,4), then put it down for a 6 point penalty.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["drop_at"],
    },
    {
        id: "level-1-arithmetic-then-move",
        sourceExample: "Calculate 5*5 and then move to (10,20)",
        message: "Work out 7*6 and afterwards go to coordinate (9,14).",
        expectedLevel: 1,
        expectedRequiresAnswer: true,
        expectedTools: ["math_eval", "move_to"],
    },
    {
        id: "level-1-computed-move",
        sourceExample: "Move to x=4*2 y=(1+3)*3 to get +5pts",
        message: "Head to x=3*(2+1), y=20/4 and earn 7 points.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["math_eval", "math_eval", "move_to"],
    },
    {
        id: "level-1-computed-drop",
        sourceExample: "Drop at x=10-6 y=5*(1+2) to get -15pts",
        message: "Put a parcel down at x=18-7, y=2*(4+1); you lose 9 points.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["math_eval", "math_eval", "drop_at"],
    },
    {
        id: "level-1-leftmost-drop",
        sourceExample: "Drop a package in the leftmost tile to get 5pt",
        message: "Deposit one parcel on the westernmost walkable tile for 4 points.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["get_extreme_tile", "drop_at"],
    },
    {
        id: "level-1-rightmost-drop",
        sourceExample: "Drop a package in the rightmost tile to get 8pt",
        message: "Put down a parcel at the furthest usable tile to the east for 11 points.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["get_extreme_tile", "drop_at"],
    },
    {
        id: "level-1-downmost-drop",
        sourceExample: "Drop a package in the down most tile to get 3pt",
        message: "Release a parcel on the lowest walkable map tile and gain 2 points.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["get_extreme_tile", "drop_at"],
    },
    {
        id: "level-1-topmost-drop",
        sourceExample: "Drop a package in the top most tile to get 6pt",
        message: "Deliver a parcel at the highest usable tile for a 9 point reward.",
        expectedLevel: 1,
        expectedRequiresAnswer: false,
        expectedTools: ["get_extreme_tile", "drop_at"],
    },
    {
        id: "level-2-integer-stack-multiplier",
        sourceExample: "Deliver stacks of exactly 3 parcels at a time to double the reward",
        message: "Only deliveries containing exactly four parcels receive triple points.",
        expectedLevel: 2,
        expectedRequiresAnswer: false,
        expectedTools: ["stack_constraint"],
    },
    {
        id: "level-2-fractional-stack-multiplier",
        sourceExample: "Deliver stacks of exactly 5 parcels at a time to get 0.3 of the standard reward",
        message: "A batch of precisely six parcels is worth 0.4 times the normal delivery reward.",
        expectedLevel: 2,
        expectedRequiresAnswer: false,
        expectedTools: ["stack_constraint"],
    },
    {
        id: "level-2-multiple-delivery-cells",
        sourceExample: "Every time you deliver in (1,5) or (3,4) you get 5x pts",
        message: "Future drop-offs at either (2,8) or (7,3) pay four times their usual value.",
        expectedLevel: 2,
        expectedRequiresAnswer: false,
        expectedTools: ["delivery_constraint", "delivery_constraint"],
    },
    {
        id: "level-2-zero-reward-cell",
        sourceExample: "Every time you deliver in (9,20) you get 0 pts",
        message: "From now on, parcels delivered at coordinate (6,12) are worth no points.",
        expectedLevel: 2,
        expectedRequiresAnswer: false,
        expectedTools: ["delivery_constraint"],
    },
    {
        id: "level-2-parcel-threshold",
        sourceExample: "If you deliver parcels with a score higher than 10, you get no reward",
        message: "Any parcel whose score exceeds 14 yields nothing when delivered.",
        expectedLevel: 2,
        expectedRequiresAnswer: false,
        expectedTools: ["parcel_constraint"],
    },
    {
        id: "level-2-avoid-cell",
        sourceExample: "Do not go through tile (10,2) otherwise you lose 50pts",
        message: "Avoid crossing cell (8,5), since entering it deducts 35 points.",
        expectedLevel: 2,
        expectedRequiresAnswer: false,
        expectedTools: ["avoid_cell"],
    },
    {
        id: "level-3-rendezvous",
        sourceExample: "Move both agents near (8,12), within distance 3, and wait for each other",
        message: "Have the two agents meet within four tiles of (10,6) and wait together for a 450 point reward.",
        expectedLevel: 3,
        expectedRequiresAnswer: false,
        expectedTools: ["plan_rendezvous"],
    },
    {
        id: "level-3-odd-row-formation",
        sourceExample: "All agents must move to an odd-numbered row and wait",
        message: "Send every agent to a cell on an odd row, then hold position; bonus: 650 points.",
        expectedLevel: 3,
        expectedRequiresAnswer: false,
        expectedTools: ["plan_grid_formation"],
    },
    {
        id: "level-3-even-column-formation",
        sourceExample: "Both agents must move to an even-numbered column and wait",
        message: "Both agents should occupy even columns and remain there to receive 375 points.",
        expectedLevel: 3,
        expectedRequiresAnswer: false,
        expectedTools: ["plan_grid_formation"],
    },
    {
        id: "level-3-parcel-handoff",
        sourceExample: "A parcel is picked up by one agent and delivered by the other",
        message: "Earn 225 points when one agent collects a parcel and its teammate completes that parcel's delivery.",
        expectedLevel: 3,
        expectedRequiresAnswer: false,
        expectedTools: ["plan_parcel_handoff"],
    },
];

/** Reads and validates configuration for the opt-in live-model experiment. */
class MissionEvaluationConfiguration {
    private constructor(
        readonly model: string,
        readonly apiUrl: string,
        readonly apiKey: string,
        readonly maximumTokens: number,
        readonly repetitions: number,
        readonly reportPath: string,
    ) { }

    static fromEnvironment(): MissionEvaluationConfiguration {
        const model = process.env.LOCAL_MODEL ?? "";
        const apiUrl = process.env.LITELLM_BASE_URL ?? "";
        const maximumTokens = MissionEvaluationConfiguration.positiveInteger(
            process.env.MAX_TOKENS,
            1_000,
            "MAX_TOKENS",
        );
        const repetitions = MissionEvaluationConfiguration.positiveInteger(
            process.env.LLM_EVALUATION_RUNS,
            1,
            "LLM_EVALUATION_RUNS",
        );

        assert.notEqual(
            model,
            "",
            "LOCAL_MODEL is required for the live LLM evaluation",
        );
        assert.notEqual(
            apiUrl,
            "",
            "LITELLM_BASE_URL is required for the live LLM evaluation",
        );

        return new MissionEvaluationConfiguration(
            model,
            apiUrl,
            process.env.LITELLM_API_KEY ?? "",
            maximumTokens,
            repetitions,
            process.env.LLM_EVALUATION_REPORT
                ?? "outputs/llm-mission-evaluation.json",
        );
    }

    private static positiveInteger(
        rawValue: string | undefined,
        fallback: number,
        variableName: string,
    ): number {
        if (rawValue === undefined || rawValue === "") {
            return fallback;
        }
        const value = Number(rawValue);
        if (!Number.isInteger(value) || value <= 0) {
            throw new RangeError(`${variableName} must be a positive integer`);
        }
        return value;
    }
}

/** Parses model output without repairing deviations from the prompted schema. */
class MissionEvaluationResponseParser {
    static classification(
        rawResponse: string,
    ): EvaluationParseResult<MissionClassificationResponse> {
        const parsed = MissionEvaluationResponseParser.json(rawResponse);
        if (parsed.error !== undefined) {
            return { value: undefined, error: parsed.error };
        }
        if (!MissionEvaluationResponseParser.isRecord(parsed.value)) {
            return {
                value: undefined,
                error: "Classification response is not a JSON object",
            };
        }
        const level = parsed.value["level"];
        const worth = parsed.value["worth"];
        const requiresAnswer = parsed.value["requires_answer"];
        if (
            !MissionEvaluationResponseParser.isMissionLevel(level)
            || typeof worth !== "boolean"
            || typeof requiresAnswer !== "boolean"
        ) {
            return {
                value: undefined,
                error: "Classification response does not match its required schema",
            };
        }
        return {
            value: { level, worth, requires_answer: requiresAnswer },
            error: undefined,
        };
    }

    static planning(
        rawResponse: string,
    ): EvaluationParseResult<MissionToolPlanningResponse> {
        const parsed = MissionEvaluationResponseParser.json(rawResponse);
        if (parsed.error !== undefined) {
            return { value: undefined, error: parsed.error };
        }
        if (!MissionEvaluationResponseParser.isRecord(parsed.value)) {
            return {
                value: undefined,
                error: "Planning response is not a JSON object",
            };
        }
        const tools = parsed.value["tools"];
        if (!Array.isArray(tools)) {
            return {
                value: undefined,
                error: "Planning response does not contain a tools array",
            };
        }
        const parsedTools: MissionToolCall[] = [];
        for (const tool of tools) {
            if (!MissionEvaluationResponseParser.isRecord(tool)) {
                return {
                    value: undefined,
                    error: "Planning response contains a non-object tool call",
                };
            }
            const name = tool["name"];
            const params = tool["params"];
            if (typeof name !== "string" || !Array.isArray(params)) {
                return {
                    value: undefined,
                    error: "A tool call does not contain a name and params array",
                };
            }
            parsedTools.push({ name, params });
        }
        return { value: { tools: parsedTools }, error: undefined };
    }

    private static json(rawResponse: string): EvaluationParseResult<unknown> {
        try {
            return { value: JSON.parse(rawResponse) as unknown, error: undefined };
        } catch (error: unknown) {
            return {
                value: undefined,
                error: error instanceof Error
                    ? error.message
                    : "Unknown JSON parsing error",
            };
        }
    }

    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    private static isMissionLevel(value: unknown): value is MissionLevel {
        return value === 1 || value === 2 || value === 3;
    }
}

/** Executes held-out messages against classification and tool-planning prompts. */
class LLMMissionEvaluationHarness {
    private readonly client: LLMClient;

    constructor(private readonly configuration: MissionEvaluationConfiguration) {
        this.client = new LLMClient(
            configuration.model,
            configuration.apiUrl,
            configuration.apiKey,
            configuration.maximumTokens,
        );
    }

    async evaluate(
        evaluationCase: MissionEvaluationCase,
        run: number,
    ): Promise<MissionEvaluationObservation> {
        const message: LLMMessage = {
            role: "user",
            content: evaluationCase.message,
        };
        const classificationRaw = await this.client.callLLM(
            [message],
            MISSION_CLASSIFICATION_INSTRUCTIONS,
        );
        const classification = MissionEvaluationResponseParser.classification(
            classificationRaw,
        );

        // This stage intentionally uses the expected level. It measures tool
        // selection separately from classification rather than compounding errors.
        const planningRaw = await this.client.callLLM(
            [message],
            LLMMissionEvaluationHarness.promptFor(evaluationCase.expectedLevel),
        );
        const planning = MissionEvaluationResponseParser.planning(planningRaw);
        const actualTools = planning.value?.tools.map(
            (tool: MissionToolCall): string => tool.name,
        );
        const classificationCorrect = classification.value?.level
            === evaluationCase.expectedLevel;
        const answerFlagCorrect = classification.value?.requires_answer
            === evaluationCase.expectedRequiresAnswer;
        const toolSelectionCorrect = actualTools !== undefined
            && LLMMissionEvaluationHarness.equalToolSequences(
                actualTools,
                evaluationCase.expectedTools,
            );

        return {
            run,
            caseId: evaluationCase.id,
            sourceExample: evaluationCase.sourceExample,
            message: evaluationCase.message,
            expectedLevel: evaluationCase.expectedLevel,
            actualLevel: classification.value?.level,
            expectedRequiresAnswer: evaluationCase.expectedRequiresAnswer,
            actualRequiresAnswer: classification.value?.requires_answer,
            expectedTools: evaluationCase.expectedTools,
            actualTools,
            classificationCorrect,
            answerFlagCorrect,
            toolSelectionCorrect,
            endToEndCorrect: classificationCorrect && toolSelectionCorrect,
            classificationRaw,
            planningRaw,
            classificationParseError: classification.error,
            planningParseError: planning.error,
        };
    }

    private static promptFor(level: MissionLevel): string {
        switch (level) {
            case 1:
                return LEVEL_1_EVALUATION_INSTRUCTIONS;
            case 2:
                return LEVEL_2_EVALUATION_INSTRUCTION;
            case 3:
                return LEVEL_3_EVALUATION_INSTRUCTION;
        }
    }

    private static equalToolSequences(
        actual: readonly string[],
        expected: readonly MissionToolName[],
    ): boolean {
        return actual.length === expected.length
            && actual.every(
                (toolName: string, index: number): boolean =>
                    toolName === expected[index],
            );
    }
}

/** Builds aggregate counts and percentages from individual observations. */
class MissionEvaluationReportFactory {
    static make(
        configuration: MissionEvaluationConfiguration,
        observations: readonly MissionEvaluationObservation[],
    ): MissionEvaluationReport {
        return {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            model: configuration.model,
            repetitions: configuration.repetitions,
            variantsPerRepetition: MISSION_EVALUATION_CASES.length,
            overall: MissionEvaluationReportFactory.metrics(observations),
            byLevel: ([1, 2, 3] as const).map(
                (level: MissionLevel): MissionLevelMetrics => ({
                    level,
                    metrics: MissionEvaluationReportFactory.metrics(
                        observations.filter(
                            (observation: MissionEvaluationObservation): boolean =>
                                observation.expectedLevel === level,
                        ),
                    ),
                }),
            ),
            observations,
        };
    }

    static summary(report: MissionEvaluationReport): string {
        return [
            `LLM mission evaluation (${report.model}, ${report.overall.observations} observations)`,
            MissionEvaluationReportFactory.metricLine("Overall", report.overall),
            ...report.byLevel.map(
                (entry: MissionLevelMetrics): string =>
                    MissionEvaluationReportFactory.metricLine(
                        `Level ${entry.level}`,
                        entry.metrics,
                    ),
            ),
        ].join("\n");
    }

    private static metrics(
        observations: readonly MissionEvaluationObservation[],
    ): MissionEvaluationMetrics {
        const total = observations.length;
        const classificationCorrect = observations.filter(
            (observation: MissionEvaluationObservation): boolean =>
                observation.classificationCorrect,
        ).length;
        const answerFlagCorrect = observations.filter(
            (observation: MissionEvaluationObservation): boolean =>
                observation.answerFlagCorrect,
        ).length;
        const toolSelectionCorrect = observations.filter(
            (observation: MissionEvaluationObservation): boolean =>
                observation.toolSelectionCorrect,
        ).length;
        const endToEndCorrect = observations.filter(
            (observation: MissionEvaluationObservation): boolean =>
                observation.endToEndCorrect,
        ).length;
        return {
            observations: total,
            classificationCorrect,
            classificationAccuracy:
                MissionEvaluationReportFactory.ratio(classificationCorrect, total),
            answerFlagCorrect,
            answerFlagAccuracy:
                MissionEvaluationReportFactory.ratio(answerFlagCorrect, total),
            toolSelectionCorrect,
            toolSelectionAccuracy:
                MissionEvaluationReportFactory.ratio(toolSelectionCorrect, total),
            endToEndCorrect,
            endToEndAccuracy:
                MissionEvaluationReportFactory.ratio(endToEndCorrect, total),
        };
    }

    private static ratio(correct: number, total: number): number {
        return total === 0 ? 0 : correct / total;
    }

    private static metricLine(
        label: string,
        metrics: MissionEvaluationMetrics,
    ): string {
        return `${label}: classification ${metrics.classificationCorrect}/${metrics.observations}`
            + ` (${MissionEvaluationReportFactory.percent(metrics.classificationAccuracy)}),`
            + ` tools ${metrics.toolSelectionCorrect}/${metrics.observations}`
            + ` (${MissionEvaluationReportFactory.percent(metrics.toolSelectionAccuracy)}),`
            + ` end-to-end ${metrics.endToEndCorrect}/${metrics.observations}`
            + ` (${MissionEvaluationReportFactory.percent(metrics.endToEndAccuracy)})`;
    }

    private static percent(ratio: number): string {
        return `${(ratio * 100).toFixed(1)}%`;
    }
}

/** Persists evaluation evidence separately from source-controlled report text. */
class MissionEvaluationReportWriter {
    static async write(
        reportPath: string,
        report: MissionEvaluationReport,
    ): Promise<void> {
        await mkdir(dirname(reportPath), { recursive: true });
        await writeFile(
            reportPath,
            `${JSON.stringify(report, undefined, 2)}\n`,
            "utf8",
        );
    }
}

test(
    "LLM classifies held-out mission variants and selects the expected tools",
    async (context: TestContext): Promise<void> => {
        const configuration = MissionEvaluationConfiguration.fromEnvironment();
        const harness = new LLMMissionEvaluationHarness(configuration);
        const observations: MissionEvaluationObservation[] = [];

        for (let run = 1; run <= configuration.repetitions; run += 1) {
            for (const evaluationCase of MISSION_EVALUATION_CASES) {
                await context.test(
                    `run ${run}: ${evaluationCase.id}`,
                    async (): Promise<void> => {
                        const observation = await harness.evaluate(
                            evaluationCase,
                            run,
                        );
                        observations.push(observation);

                        assert.equal(
                            observation.classificationParseError,
                            undefined,
                            `Invalid classification JSON: ${observation.classificationRaw}`,
                        );
                        assert.equal(
                            observation.actualLevel,
                            observation.expectedLevel,
                            `Classification mismatch for: ${observation.message}`,
                        );
                        assert.equal(
                            observation.actualRequiresAnswer,
                            observation.expectedRequiresAnswer,
                            `requires_answer mismatch for: ${observation.message}`,
                        );
                        assert.equal(
                            observation.planningParseError,
                            undefined,
                            `Invalid planning JSON: ${observation.planningRaw}`,
                        );
                        assert.deepEqual(
                            observation.actualTools,
                            observation.expectedTools,
                            `Tool-selection mismatch for: ${observation.message}`,
                        );
                    },
                );
            }
        }

        const report = MissionEvaluationReportFactory.make(
            configuration,
            observations,
        );
        await MissionEvaluationReportWriter.write(
            configuration.reportPath,
            report,
        );
        context.diagnostic(MissionEvaluationReportFactory.summary(report));
        context.diagnostic(`Detailed report: ${configuration.reportPath}`);
    },
);
