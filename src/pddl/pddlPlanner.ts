import { GameMap, NeighborCoord } from "../map.js";
import { Action, ActionFactory } from "../move.js";
import { Position } from "../utils/position.js";
import { PDDLProblem } from "./PddlProblem.js";
import { PddlPlanStep } from "./onlineSolver.js";

export interface PDDLGoal {
    agentId: string,
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
        crates: Position[],
        playerId: string,
        playerPos: Position,
    ){
        this.problemPDDL.clearProblem();

        const occupiedCrateCells = new Set<string>(
            crates.map((crate: Position): string => this.positionToCellString(crate)),
        );

        this.convertMapToPDDLRepresentation(map, occupiedCrateCells);
        this.convertPlayerInfoToPDDLRepresentation(playerId, playerPos);
        this.convertCratesInfoToPDDLRepresentation(occupiedCrateCells);
    }

    public buildGoal(goal: PDDLGoal) {
        const cellName = this.positionToCellString(goal.finalTargetPosition);
        this.problemPDDL.addGoal(`(agent-at ag_${goal.agentId} ${cellName})`);
    }

    private convertCratesInfoToPDDLRepresentation(
        occupiedCrateCells: ReadonlySet<string>,
    ): void {
        occupiedCrateCells.forEach((crateCellName: string): void => {
            this.problemPDDL.addInit(`(crate-at ${crateCellName})`);
        });
    }

    private convertPlayerInfoToPDDLRepresentation(playerId: string, playerPos: Position) {
        this.problemPDDL.setAgent(playerId);

        const cellName = this.positionToCellString(playerPos);
        // Use agent-at (matching domain)
        this.problemPDDL.addInit(`(agent-at ag_${playerId} ${cellName})`);
    }

    private convertMapToPDDLRepresentation(
        map: GameMap,
        occupiedCrateCells: ReadonlySet<string>,
    ): void {
        for (let row = 0; row < map.getRows(); row++){
            for (let col = 0; col < map.getCols(); col++){
                const cellPosition: Position = new Position(row, col);

                if(map.isValidCell(cellPosition)){
                    const cellName = this.positionToCellString(new Position(row, col));
                    this.problemPDDL.addTile(cellName);

                    if (!occupiedCrateCells.has(cellName)) {
                        this.problemPDDL.addInit(`(crate-free ${cellName})`);
                    }

                    const cellType = map.getCellValue(cellPosition);
                    if (cellType === "5" || cellType === "5!") {
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

    public async solveProblem(): Promise<Action[] | undefined> {
        const pddlResult = await this.problemPDDL.solve();

        return pddlResult === undefined
            ? undefined
            : this.convertPDDLActionsToAgentActions(pddlResult);
    }

    private convertPDDLActionsToAgentActions(solverResult: PddlPlanStep[]): Action[] {
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
            }
        }

        return actions;
    }

    public printProblem(): string {
        return this.problemPDDL.toPDDLProblemString();
    }
}
