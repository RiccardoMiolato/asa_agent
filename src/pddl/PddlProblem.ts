import { onlineSolver, SolverResult } from '@unitn-asa/pddl-client';
import fs from "fs";

export class PDDLProblem {
    private tiles: string[];
    private agent: string;
    private parcels: string[];
    private init: string[];
    private goals: string[];
    private goalSet: boolean;

    private padding = '    ';

    constructor() {
        this.tiles = [];
        this.agent = "";
        this.parcels = [];
        this.init = [];
        this.goals = [];

        this.goalSet = false;
    }

    public clearProblem() {
        this.tiles = [];
        this.agent = "";
        this.parcels = [];
        this.init = [];
        this.goals = [];

        this.goalSet = false;
    }

    public toPDDLProblemString(): string {
        return `(define (problem problem_to_solve)
${this.padding}(:domain deliveroo)
${this.padding}(:objects
${this.padding}${this.padding}${this.tiles.join(" ").trim()} - position
${this.padding}${this.padding}${this.agent} - agent
${this.padding}${this.padding}${this.parcels.join(" ").trim()} - parcel
${this.padding})
${this.padding}(:init ${this.init.join(" ").trim()})
${this.padding}(:goal (and ${this.goals.join(" ").trim()}))
)`;
    }

    public addTile(tile: string) {
        this.tiles.push(tile);
    }

    public setAgent(agentId: string) {
        this.agent = `ag_${agentId}`;
    }

    public addParcel(parcelId: string) {
        this.parcels.push(`${parcelId}`);
    }

    public addInit(initPredicate: string) {
        this.init.push(initPredicate);
    }

    public addGoal(goalPredicate: string) {
        this.goalSet = true;
        this.goals.push(goalPredicate);
    }

    public async solve(): Promise<SolverResult> {
        if(!this.goalSet)
            throw new Error("Cannot solve this due to missing goals");

        const domainPath = './src/pddl/domain.pddl';
        if (!fs.existsSync(domainPath)) {
            throw new Error(`Domain file not found at path: ${domainPath}`);
        }
        const domainText = fs.readFileSync(domainPath, 'utf-8');

        const problemText = this.toPDDLProblemString();
        const plan: SolverResult = await onlineSolver(domainText, problemText);

        console.log("FINAL PLAN: ", plan);
        return plan;
    }
}