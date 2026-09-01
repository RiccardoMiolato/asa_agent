export interface IOParcel {
    id: string;
    x: number;
    y: number;
    carriedBy?: string | null;
    reward: number;
}
