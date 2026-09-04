import fs from "fs";
import localSolver from "./onlineSolver.js";
export class PDDLProblem {
    constructor() {
        this.padding = '    ';
        this.tiles = [];
        this.agent = "";
        this.init = [];
        this.goals = [];
        this.goalSet = false;
    }
    clearProblem() {
        this.tiles = [];
        this.agent = "";
        this.init = [];
        this.goals = [];
        this.goalSet = false;
    }
    toPDDLProblemString() {
        return `(define (problem deliveroo_problem)
${this.padding}(:domain deliveroo)
${this.padding}(:objects
${this.tiles.length > 0 ? `${this.padding}${this.padding}${this.tiles.join(" ").trim()} - position\n` : ''}${this.agent ? `${this.padding}${this.padding}${this.agent} - agent\n` : ''})
${this.padding}(:init ${this.init.join(" ").trim()})
${this.padding}(:goal (and ${this.goals.join(" ").trim()}))
)`;
    }
    addTile(tile) {
        this.tiles.push(tile);
    }
    setAgent(agentId) {
        this.agent = `ag_${agentId}`;
    }
    addInit(initPredicate) {
        this.init.push(initPredicate);
    }
    addGoal(goalPredicate) {
        this.goalSet = true;
        this.goals.push(goalPredicate);
    }
    async solve() {
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
//# sourceMappingURL=PddlProblem.js.map