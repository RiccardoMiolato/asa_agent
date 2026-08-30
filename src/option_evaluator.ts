import { Parcel } from "./beliefs.js";
import { IntentionContext } from "./intentions.js";
import { Position } from "./position.js";

type OptionType = "pick" | "drop";

export class Option {
    private optionType: OptionType;
    private parcelId: string | undefined;
    private targetCell: Position;
    private score: number;

    constructor(optionType: OptionType, targetCell: Position, parcelId: string | undefined = undefined) {
        this.optionType = optionType;
        this.targetCell = targetCell;
        this.score = -Infinity;

        if(this.optionType === "pick")
            this.parcelId = parcelId;
    }

    getType (): OptionType {
        return this.optionType;
    }

    getTargetCell (): Position {
        return this.targetCell;
    }

    getParcelId (): string | undefined {
        return this.parcelId;
    }

    getScore(): number {
        return this.score;
    }

    setScore(score: number) {
        this.score = score;
    }
}

interface EvaluationResult {
    bestOption: Option | undefined;
    totalScore: number;
}

export class OptionEvaluator {
    evaluate(context: IntentionContext): Option | undefined {
        const optionSet: Set<Option> = new Set();
        const carriedParcelIds: string[] = [];

        context.parcels.forEach((parcel: Parcel) => {
            if(parcel.carriedBy === context.agentId) {
                carriedParcelIds.push(parcel.id);
            } else if (!parcel.carriedBy) {
                const parcelOption = new Option(
                    "pick",
                    new Position(parcel.x, parcel.y),
                    parcel.id
                );
                optionSet.add(parcelOption);
            }
        });

        if(carriedParcelIds.length > 0){
            const closestDeliveryFromAgent: Position | undefined = this.shortestDeliveryFrom(
                context,
                context.agentPosition
            );

            if(closestDeliveryFromAgent)
                optionSet.add(new Option("drop", closestDeliveryFromAgent));
        }

        const result = this.evaluateRec(
            context,
            context.agentPosition,
            optionSet,
            carriedParcelIds,
            0
        );

        return result.bestOption;
    }

    private evaluateRec(
        context: IntentionContext,
        agentPosition: Position,
        optionSet: Set<Option>,
        carriedParcelIds: string[],
        elapsedTime: number
    ): EvaluationResult {
        // Base case: no more options to evaluate
        if (optionSet.size === 0) {
            const finalScore = this.computeDeliveryScore(context, carriedParcelIds, elapsedTime);
            return { bestOption: undefined, totalScore: finalScore };
        }

        let bestResult: EvaluationResult = { bestOption: undefined, totalScore: Number.NEGATIVE_INFINITY };

        optionSet.forEach((option: Option) => {
            const targetDistance = context.pathfinder.pathLength(
                context.gameMap,
                agentPosition,
                option.getTargetCell(),
                context.crates
            );

            // Skip unreachable options
            if (targetDistance === undefined)
                return;

            const newElapsedTime = elapsedTime + (targetDistance * context.movementDuration) / 1000.0;
            const newOptionSet: Set<Option> = new Set(optionSet);
            newOptionSet.delete(option);

            let newCarriedIds = [...carriedParcelIds];
            let scoreForThisOption = 0;

            if (option.getType() === "pick") {
                newCarriedIds.push(option.getParcelId()!);

                const closestDeliveryFromParcel: Position | undefined = this.shortestDeliveryFrom(
                    context,
                    option.getTargetCell()
                );

                if (closestDeliveryFromParcel) {
                    const existingDropOption = Array.from(newOptionSet).find(
                        (opt) => opt.getType() === "drop"
                    );
                    if (existingDropOption) {
                        newOptionSet.delete(existingDropOption);
                    }
                    newOptionSet.add(new Option("drop", closestDeliveryFromParcel));
                }
            } else { // drop case
                scoreForThisOption = this.computeDeliveryScore(context, carriedParcelIds, newElapsedTime);
                newCarriedIds = [];
            }

            const nextResult = this.evaluateRec(
                context,
                option.getTargetCell(),
                newOptionSet,
                newCarriedIds,
                newElapsedTime
            );

            const totalScore = scoreForThisOption + nextResult.totalScore;
            option.setScore(totalScore);

            if (totalScore > bestResult.totalScore) {
                bestResult = { bestOption: option, totalScore };
            }
        });

        return bestResult;
    }

    private shortestDeliveryFrom(context: IntentionContext, startingPosition: Position): Position | undefined {
        let closestCell: Position | undefined = undefined;
        let closestCellDistance: number = Infinity;

        context.deliveringCells.forEach(delivery => {
            const distance = context.pathfinder.pathLengthAllowingCrateMoves(
                context,
                startingPosition,
                delivery,
            );

            if(distance !== undefined && distance < closestCellDistance) {
                closestCell = delivery;
                closestCellDistance = distance;
            }
        });

        return closestCell;
    }

    private computeDeliveryScore(context: IntentionContext, carriedParcelIds: string[], elapsedTime: number): number {
        let deliveryScore = 0;

        carriedParcelIds.forEach((parcelId: string) => {
            const parcel = context.parcels.get(parcelId);

            if(parcel) {
                const remainingReward = Math.max(0, parcel.reward - elapsedTime);
                deliveryScore += remainingReward;
            }
        });

        return deliveryScore;
    }
}