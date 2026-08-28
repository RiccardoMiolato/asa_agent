import { Parcel } from "../beliefs.js";
import { GameMap, NeighborCoord } from "../map.js";
import { Action } from "../move.js";
import { Position } from "../position.js";
import { PDDLProblem } from "./PddlProblem.js";

export type OperationType = "search" | "pickup" | "deliver";

export interface PDDLGoal {
    operationType: OperationType,
    agentId: string,
    parcelId: string | null,
    carriedParcels: Parcel[],
    finalTargetPosition: Position,
}

/**
 * This class is responsible for the generation
 * of the plan given an intention
 */
export class PDDLPlanner {
    private problemPDDL: PDDLProblem;

    constructor() {
        this.problemPDDL = new PDDLProblem();
    }

    public resetPDDL() {
        this.problemPDDL.clearProblem();
    }

    public buildPDDLProblem(
        map: GameMap,
        parcels: Parcel[],
        playerId: string,
        playerPos: Position,
    ){
        this.problemPDDL.clearProblem();

        this.convertMapToPDDLRepresentation(map);
        this.convertPlayerInfoToPDDLRepresentation(playerId, playerPos);
        this.convertParcelsInfoToPDDLRepresentation(parcels);
    }

    public buildGoal(goal: PDDLGoal) {
        let cellName: string;
        switch(goal.operationType) {
            case "search":
                if(!goal.finalTargetPosition)
                    return;

                cellName = this.positionToCellString(goal.finalTargetPosition);

                this.problemPDDL.addGoal(`(player-at ag_${goal.agentId} ${cellName})`);
                break;
            case "pickup":
                cellName = this.positionToCellString(goal.finalTargetPosition);

                this.problemPDDL.addGoal(`(player-at ag_${goal.agentId} ${cellName})`);
                this.problemPDDL.addGoal(`(carrying ag_${goal.agentId} ${goal.parcelId})`);
                break;
            case "deliver":
                cellName = this.positionToCellString(goal.finalTargetPosition);

                this.problemPDDL.addGoal(`(player-at ag_${goal.agentId} ${cellName})`);

                goal.carriedParcels.forEach(_ => {
                    this.problemPDDL.addInit(`(carrying ag_${goal.agentId} ${goal.parcelId})`);
                    this.problemPDDL.addGoal(`(delivered ${goal.parcelId})`);
                })
                break;
        }
    }

    private convertPlayerInfoToPDDLRepresentation(playerId: string, playerPos: Position) {
        this.problemPDDL.setAgent(playerId);

        const cellName = this.positionToCellString(playerPos);
        this.problemPDDL.addInit(`(agent-at ag_${playerId} ${cellName})`);
    }

    private convertParcelsInfoToPDDLRepresentation(parcels: Parcel[]) {
        parcels.forEach((parcel) => {
            if(parcel.carriedBy == null){
                const parcelStr: string = `${parcel.id}`;
                const cellName = this.positionToCellString(new Position(parcel.x, parcel.y));

                this.problemPDDL.addParcel(parcelStr);
                this.problemPDDL.addInit(`(parcel-at ${parcelStr} ${cellName})`);
            }
        });
    }

    private convertMapToPDDLRepresentation(map: GameMap) {
        for (let row = 0; row < map.getRows(); row++){
            for (let col = 0; col < map.getCols(); col++){
                const cellPosition: Position = new Position(row, col);

                if(map.isValidCell(cellPosition)){
                    const cellName = this.positionToCellString(new Position(row, col));
                    this.problemPDDL.addTile(cellName);

                    map.getNeighborsOf(cellPosition)
                        .forEach((neighbor: NeighborCoord) => {
                            let predicateString = "";

                            switch(neighbor.direction) {
                                case "up":
                                    predicateString = "upper-cell";
                                    break;
                                case "down":
                                    predicateString = "lower-cell";
                                    break;
                                case "left":
                                    predicateString = "left-cell";
                                    break;
                                case "right":
                                    predicateString = "right-cell";
                                    break;
                            }

                            const neighborName = this.positionToCellString(neighbor.coord)
                            const new_predicate = `(${predicateString} ${cellName} ${neighborName})`;
                            this.problemPDDL.addInit(new_predicate);
                        });
                }
            }
        }
    }

    private positionToCellString(pos: Position): string {
        return `t_${pos.x}_${pos.y}`;
    }

    public async solveProblem(): Promise<void> {
        try {
            const pddl_actions = await this.problemPDDL.solve();
        } catch (_) {
        }
    }

    private convertPDDLActionsToAgentActions(): Action[] {
        return [];
    }

    public printProblem(): string {
        return this.problemPDDL.toPDDLProblemString();
    }
}