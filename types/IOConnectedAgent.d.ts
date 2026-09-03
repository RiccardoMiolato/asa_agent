/** Agent metadata broadcast by the Deliveroo controller event. */
export interface IOConnectedAgent {
    readonly id: string;
    readonly name: string;
    readonly teamId: string;
    readonly teamName: string;
    readonly score: number;
}
