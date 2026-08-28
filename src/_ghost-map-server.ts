import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, resolve } from "node:path";
import type { AgentGhostMapSnapshotProvider } from "./_ghost-map-snapshot.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

/** Serves the local, read-only visualization of one agent's beliefs. */
export class GhostMapServer {
    private readonly staticRoot: string;
    private server: Server | undefined;

    constructor(
        private readonly snapshots: AgentGhostMapSnapshotProvider,
        private readonly port: number,
    ) {
        const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
        this.staticRoot = resolve(projectRoot, "ghost-map");
    }

    start(): Promise<void> {
        if (this.server) {
            return Promise.resolve();
        }

        this.server = createServer((request, response): void => {
            const pathname = new URL(
                request.url ?? "/",
                "http://localhost",
            ).pathname;

            if (pathname === "/api/state") {
                this.sendJson(response, this.snapshots.snapshot());
                return;
            }
            if (pathname === "/health") {
                this.sendJson(response, { status: "ok" });
                return;
            }

            const assetName = pathname === "/"
                ? "index.html"
                : pathname.slice(1);
            if (!["index.html", "app.js", "styles.css"].includes(assetName)) {
                this.sendNotFound(response);
                return;
            }
            void this.sendStaticAsset(response, assetName);
        });

        return new Promise<void>((resolveStart, rejectStart): void => {
            this.server?.once("error", rejectStart);
            this.server?.listen(this.port, "127.0.0.1", (): void => {
                this.server?.removeListener("error", rejectStart);
                resolveStart();
            });
        });
    }

    private async sendStaticAsset(
        response: ServerResponse,
        assetName: string,
    ): Promise<void> {
        const assetPath = resolve(this.staticRoot, assetName);
        try {
            const assetStat = await stat(assetPath);
            if (!assetStat.isFile()) {
                this.sendNotFound(response);
                return;
            }
            response.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Type": CONTENT_TYPES[extname(assetPath)]
                    ?? "application/octet-stream",
            });
            createReadStream(assetPath).pipe(response);
        } catch {
            this.sendNotFound(response);
        }
    }

    private sendJson(response: ServerResponse, payload: unknown): void {
        response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(payload));
    }

    private sendNotFound(response: ServerResponse): void {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
    }
}
