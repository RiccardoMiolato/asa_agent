import { SolverResult } from "@unitn-asa/pddl-client";
import { Parcel } from "../beliefs.js";
import { GameMap, NeighborCoord } from "../map.js";
import { Action, ActionFactory } from "../move.js";
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
    private actionFactory: ActionFactory;

    constructor(actionFactory: ActionFactory) {
        this.problemPDDL = new PDDLProblem();
        this.actionFactory = actionFactory;
    }

    public resetPDDL() {
        this.problemPDDL.clearProblem();
    }

    public buildPDDLProblem(
        map: GameMap,
        parcels: Parcel[],
        crates: Position[],
        playerId: string,
        playerPos: Position,
    ){
        this.problemPDDL.clearProblem();

        this.convertMapToPDDLRepresentation(map);
        this.convertPlayerInfoToPDDLRepresentation(playerId, playerPos);
        this.convertParcelsInfoToPDDLRepresentation(parcels, playerId);
        this.convertCratesInfoToPDDLRepresentation(crates);
    }

    public buildGoal(goal: PDDLGoal) {
        let cellName: string;
        switch(goal.operationType) {
            case "search":
                if(!goal.finalTargetPosition)
                    return;

                cellName = this.positionToCellString(goal.finalTargetPosition);
                this.problemPDDL.addGoal(`(agent-at ag_${goal.agentId} ${cellName})`);
                break;

            case "pickup":
                cellName = this.positionToCellString(goal.finalTargetPosition);
                this.problemPDDL.addGoal(`(agent-at ag_${goal.agentId} ${cellName})`);
                this.problemPDDL.addGoal(`(carrying ag_${goal.agentId} parcel_${goal.parcelId})`);
                break;

            case "deliver":
                cellName = this.positionToCellString(goal.finalTargetPosition);

                this.problemPDDL.addGoal(`(agent-at ag_${goal.agentId} ${cellName})`);
                goal.carriedParcels.forEach((parcel) => {
                    this.problemPDDL.addGoal(`(delivered parcel_${parcel.id})`);
                });
                break;
        }
    }

    private convertCratesInfoToPDDLRepresentation(crates: Position[]) {
        crates.forEach(crate => {
            const crateName = `crate_${crate.x}_${crate.y}`;
            const crateTileName = this.positionToCellString(crate);

            this.problemPDDL.addCrate(crateName);
            this.problemPDDL.addInit(`(crate-at ${crateName} ${crateTileName})`)
        });
    }

    private convertPlayerInfoToPDDLRepresentation(playerId: string, playerPos: Position) {
        this.problemPDDL.setAgent(playerId);

        const cellName = this.positionToCellString(playerPos);
        // Use agent-at (matching domain)
        this.problemPDDL.addInit(`(agent-at ag_${playerId} ${cellName})`);
    }

    private convertParcelsInfoToPDDLRepresentation(parcels: Parcel[], agentId: string) {
        parcels.forEach((parcel) => {
            // Only add free parcels (not carried by anyone)
            const parcelStr: string = parcel.id;
            this.problemPDDL.addParcel(parcelStr);

            if (parcel.carriedBy == null) {
                const cellName = this.positionToCellString(new Position(parcel.x, parcel.y));

                // Use parcel_ prefix to match domain typing
                this.problemPDDL.addInit(`(parcel-at parcel_${parcelStr} ${cellName})`);
            } else if (parcel.carriedBy === agentId){
                this.problemPDDL.addInit(`(carrying ag_${agentId} parcel_${parcelStr})`)
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

                    // Add pickup/delivery information based on cell type
                    const cellType = map.getCellValue(cellPosition);
                    if (cellType === "1") {
                        this.problemPDDL.addInit(`(pickup-at ${cellName})`);
                    } else if (cellType === "2") {
                        this.problemPDDL.addInit(`(delivery-at ${cellName})`);
                    } else if (cellType === "5" || cellType === "5!") {
                        this.problemPDDL.addInit(`(crate-cell ${cellName})`);
                    }

                    // Add neighbor relationships
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

    public async solveProblem(): Promise<Action[]> {
        try {
            const pddlResult = await this.problemPDDL.solve();

            if (Array.isArray(pddlResult)) {
                return this.convertPDDLActionsToAgentActions(pddlResult);
            }

            return [];
        } catch (error) {
            console.error("PDDL planning failed:", error);
            return [];
        }
    }

    private convertPDDLActionsToAgentActions(solverResult: SolverResult[]): Action[] {
        const actions: Action[] = [];

        for (const result of solverResult) {
            const actionName = result.action.toUpperCase();

            switch (actionName) {
                case 'MOVE-UP':
                case 'CRATE-MOVE-UP':
                    actions.push(this.actionFactory.moveUp());
                    break;
                case 'MOVE-DOWN':
                case 'CRATE-MOVE-DOWN':
                    actions.push(this.actionFactory.moveDown());
                    break;
                case 'MOVE-LEFT':
                case 'CRATE-MOVE-LEFT':
                    actions.push(this.actionFactory.moveLeft());
                    break;
                case 'MOVE-RIGHT':
                case 'CRATE-MOVE-RIGHT':
                    actions.push(this.actionFactory.moveRight());
                    break;
                case 'PICK-UP':
                    // args[1] is PARCEL_P514, extract P514
                    const parcelId = result.args[1]?.replace('PARCEL_', '') || '';
                    actions.push(this.actionFactory.pickUp(parcelId, result.args[0]));
                    break;
                case 'DELIVER':
                    // args[0] is agent ID
                    actions.push(this.actionFactory.drop(result.args[0]));
                    break;
            }
        }

        return actions;
    }

    public printProblem(): string {
        return this.problemPDDL.toPDDLProblemString();
    }
}
