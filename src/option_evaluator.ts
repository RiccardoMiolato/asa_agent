import { Parcel } from "./beliefs.js";
import { IntentionContext } from "./intentions.js";
import { Position } from "./position.js";

type OptionType = "pick" | "drop";

class Option {
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

class OptionEvaluator {
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
            const closestDeliveryFromParcel: Position | undefined = this.shortestDeliveryFrom(
                context,
                context.agentPosition
            );

            if(closestDeliveryFromParcel)
                optionSet.add(new Option("drop", closestDeliveryFromParcel));
        }

        return this.evaluateRec(
            context,
            context.agentPosition,
            optionSet,
            carriedParcelIds,
        )
    }

    private evaluateRec(
        context: IntentionContext,
        agentPosition: Position,
        optionSet: Set<Option>,
        carriedParcelIds: string[],
        elapsedTime: number = 0,
        carriedScore: number = 0
    ): Option | undefined {
        if(optionSet.size == 0)
            return undefined;

        let bestOption: Option | undefined = undefined;
        let bestOptionScore: number = -Infinity;

        optionSet.forEach((option: Option) => {
            const newOptionSet: Set<Option> = new Set(optionSet);
            newOptionSet.delete(option);

            const targetDistance = context.pathfinder.pathLength(
                context.gameMap,
                agentPosition,
                option.getTargetCell(),
                context.crates
            );

            if(!targetDistance)
                return;

            elapsedTime += (targetDistance * context.movementDuration) / 1000.0;

            if(option.getType() === "pick") {
                carriedParcelIds.push(option.getParcelId()!);

                const closestDeliveryFromParcel: Position | undefined = this.shortestDeliveryFrom(
                    context,
                    agentPosition
                );

                if (closestDeliveryFromParcel) {
                    const dropOption = Array.from(newOptionSet).find(
                        (opt) => opt.getType() === "drop"
                    );

                    if (dropOption) {
                        newOptionSet.delete(dropOption);
                    }

                    newOptionSet.add(
                        new Option("drop", closestDeliveryFromParcel)
                    );
                }
            } else { // drop case
                const deliveryScore = this.computeDeliveryScore(context, carriedParcelIds, elapsedTime);
                carriedScore += deliveryScore;

                carriedParcelIds = [];
            }

            const nextOption: Option | undefined = this.evaluateRec(
                context,
                option.getTargetCell(),
                newOptionSet,
                carriedParcelIds,
                elapsedTime,
                carriedScore
            );

            if (nextOption && nextOption.getScore() > bestOptionScore) {
                bestOption = nextOption;
                bestOptionScore = bestOption.getScore();
            }
        });

        return bestOption;
    }

    private shortestDeliveryFrom(context: IntentionContext, startingPosition: Position): Position | undefined{
        let closestCell: Position | undefined = undefined;
        let closestCellDistance: number = Infinity;

        context.deliveringCells.forEach(delivery => {
            const distance = context.pathfinder.pathLengthAllowingCrateMoves(
                context,
                startingPosition,
                delivery,
            );

            if(distance && distance < closestCellDistance) {
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

            if(parcel)
                deliveryScore += Math.max(0, parcel?.reward - elapsedTime);
        });

        return deliveryScore;
    }
}