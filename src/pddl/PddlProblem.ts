import fs from "fs";
import localSolver, { PddlPlanStep } from "./onlineSolver.js";

export class PDDLProblem {
    private tiles: string[];
    private agent: string;
    private crates: string[];
    private init: string[];
    private goals: string[];
    private goalSet: boolean;

    private padding = '    ';

    constructor() {
        this.tiles = [];
        this.agent = "";
        this.crates = [];
        this.init = [];
        this.goals = [];

        this.goalSet = false;
    }

    public clearProblem() {
        this.tiles = [];
        this.agent = "";
        this.crates = [];
        this.init = [];
        this.goals = [];

        this.goalSet = false;
    }

    public toPDDLProblemString(): string {
        return `(define (problem deliveroo_problem)
${this.padding}(:domain deliveroo)
${this.padding}(:objects
${this.tiles.length > 0 ? `${this.padding}${this.padding}${this.tiles.join(" ").trim()} - position\n` : ''}${this.agent ? `${this.padding}${this.padding}${this.agent} - agent\n` : ''}${this.crates.length > 0 ? `${this.padding}${this.padding}${this.crates.join(" ").trim()} - crate\n` : ''})
${this.padding}(:init ${this.init.join(" ").trim()})
${this.padding}(:goal (and ${this.goals.join(" ").trim()}))
)`;
    }

    public addTile(tile: string) {
        this.tiles.push(tile);
    }

    public addCrate(crate: string) {
        this.crates.push(crate);
    }

    public setAgent(agentId: string) {
        this.agent = `ag_${agentId}`;
    }

    public addInit(initPredicate: string) {
        this.init.push(initPredicate);
    }

    public addGoal(goalPredicate: string) {
        this.goalSet = true;
        this.goals.push(goalPredicate);
    }

    public async solve(): Promise<PddlPlanStep[] | undefined> {
        if (!this.goalSet)
            throw new Error("Cannot solve this due to missing goals");

        const domainPath = './src/pddl/domain.pddl';
        if (!fs.existsSync(domainPath)) {
            throw new Error(`Domain file not found at path: ${domainPath}`);
        }
        const domainText = fs.readFileSync(domainPath, 'utf-8');

        const problemText = this.toPDDLProblemString();

        // Log the problem for debugging
        // console.log("=== PDDL PROBLEM ===");
        const outputDir = './outputs';
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        const outputPath = `${outputDir}/problem.pddl`;
        fs.writeFileSync(outputPath, problemText, 'utf-8');
        console.log(`PDDL problem written to ${outputPath}`);
        // console.log("=== END PDDL PROBLEM ===");

        return await localSolver(domainText, problemText);
    }
}
