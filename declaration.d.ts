declare module '@unitn-asa/deliveroo-js-sdk/client' {
    export type MoveDirection = 'up' | 'right' | 'left' | 'down';

    export interface DjsClientSocket {
        onConnect(callback: () => void): void;
        onAgentConnected(
            callback: (
                status: 'connected' | 'disconnected',
                agent: import('./types/IOConnectedAgent.js').IOConnectedAgent,
            ) => void,
        ): void;
        onConfig(callback: (config: import('./types/IOConfig.js').IOConfig) => void): void;
        onYou(callback: (agent: import('./types/IOAgent.js').IOAgent) => void): void;
        onMsg(callback: (senderId: string, senderName: string, message: unknown, reply?: (msg: unknown) => void) => void): void;
        onSensing(callback: (sensing: import('./types/IOSensing.js').IOSensing) => void): void;
        connect(): DjsClientSocket;
        disconnect(): void;
        emitMove(direction: MoveDirection): Promise<{ x: number; y: number } | false>;
        emitPickup(): Promise<{ id: string }[]>;
        emitPutdown(selected?: string[] | null): Promise<{ id: string }[]>;
        emitSay(toId: string, msg: unknown): Promise<'successful' | 'failed'>;
    }

    export function DjsConnect(
        host?: string,
        token?: string,
        name?: string,
        autoconnect?: boolean,
    ): DjsClientSocket;
}
