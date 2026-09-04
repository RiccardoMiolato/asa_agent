import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, resolve } from "node:path";
const CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};
/** Serves the local, read-only visualization of one agent's beliefs. */
export class GhostMapServer {
    constructor(snapshots, port) {
        this.snapshots = snapshots;
        this.port = port;
        const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
        this.staticRoot = resolve(projectRoot, "ghost-map");
    }
    start() {
        if (this.server) {
            return Promise.resolve();
        }
        this.server = createServer((request, response) => {
            const requestUrl = new URL(request.url ?? "/", "http://localhost");
            const pathname = requestUrl.pathname;
            if (pathname === "/api/state") {
                const includeMapTiles = requestUrl.searchParams.get("includeMap")
                    !== "false";
                this.sendJson(response, this.snapshots.snapshot(includeMapTiles));
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
        return new Promise((resolveStart, rejectStart) => {
            this.server?.once("error", rejectStart);
            this.server?.listen(this.port, "127.0.0.1", () => {
                this.server?.removeListener("error", rejectStart);
                resolveStart();
            });
        });
    }
    /** Stops the local visualization server so the process can exit cleanly. */
    stop() {
        if (!this.server) {
            return Promise.resolve();
        }
        const server = this.server;
        this.server = undefined;
        if (!server.listening) {
            return Promise.resolve();
        }
        return new Promise((resolveStop, rejectStop) => {
            server.close((error) => {
                if (error) {
                    rejectStop(error);
                    return;
                }
                resolveStop();
            });
        });
    }
    async sendStaticAsset(response, assetName) {
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
        }
        catch {
            this.sendNotFound(response);
        }
    }
    sendJson(response, payload) {
        response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(payload));
    }
    sendNotFound(response) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
    }
}
//# sourceMappingURL=_ghost-map-server.js.map