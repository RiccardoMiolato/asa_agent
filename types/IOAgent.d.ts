export interface IOAgent {
    id: string;
    name: string;
    teamId: string;
    teamName: string;
    x?: number;
    y?: number;
    score: number;
    penalty: number;
}
