declare module '@unitn-asa/deliveroo-js-sdk/client' {
    export type MoveDirection = 'up' | 'right' | 'left' | 'down';

    export interface DjsClientSocket {
        onConnect(callback: () => void): void;
        onConfig(callback: (config: import('./types/IOConfig.js').IOConfig) => void): void;
        onYou(callback: (agent: import('./types/IOAgent.js').IOAgent) => void): void;
        onMsg(callback: (senderId: string, senderName: string, message: any, reply?: (msg: any) => void) => void): void;
        onSensing(callback: (sensing: import('./types/IOSensing.js').IOSensing) => void): void;
        disconnect(): void;
        emitMove(direction: MoveDirection): Promise<{ x: number; y: number } | false>;
        emitPickup(): Promise<{ id: string }[]>;
        emitPutdown(selected?: string[] | null): Promise<{ id: string }[]>;
        emitSay (toId: string, msg: any ): Promise<'successful' | 'failed'>;
    }

    export function DjsConnect(
        host?: string,
        token?: string,
        name?: string,
        autoconnect?: boolean,
    ): DjsClientSocket;
}
