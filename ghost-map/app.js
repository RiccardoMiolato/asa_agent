const elements = {
    connection: document.querySelector("#connection"),
    connectionLabel: document.querySelector("#connection-label"),
    agentName: document.querySelector("#agent-name"),
    agentId: document.querySelector("#agent-id"),
    agentPosition: document.querySelector("#agent-position"),
    agentScore: document.querySelector("#agent-score"),
    agentCycle: document.querySelector("#agent-cycle"),
    targetPosition: document.querySelector("#target-position"),
    targetIntention: document.querySelector("#target-intention"),
    clusterSummary: document.querySelector("#cluster-summary"),
    map: document.querySelector("#map"),
    mapTitle: document.querySelector("#map-title"),
    mapSize: document.querySelector("#map-size"),
    emptyState: document.querySelector("#empty-state"),
    lastUpdate: document.querySelector("#last-update"),
};

let requestInFlight = false;

class GhostMapRenderer {
    render(snapshot) {
        this.renderConnection(snapshot.ready);
        this.renderAgent(snapshot.agent);
        this.renderTarget(snapshot.target);
        this.renderMap(snapshot);
        elements.lastUpdate.textContent = `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}`;
    }

    renderConnection(ready) {
        elements.connection.className = `connection ${ready ? "online" : ""}`;
        elements.connectionLabel.textContent = ready ? "Live agent state" : "Waiting for agent";
    }

    renderAgent(agent) {
        elements.agentName.textContent = agent.name || "Unnamed agent";
        elements.agentId.textContent = agent.id || "No identity yet";
        elements.agentId.title = agent.id || "";
        elements.agentPosition.textContent = formatPosition(agent.position);
        elements.agentScore.textContent = agent.score ?? "—";
        elements.agentCycle.textContent = agent.deliberationCycle;
    }

    renderTarget(target) {
        elements.targetPosition.textContent = target
            ? formatPosition(target.position)
            : "No target";
        elements.targetIntention.textContent = target
            ? `${target.intention.replace("-", " ")} intention`
            : "Waiting for deliberation";
    }

    renderMap(snapshot) {
        const { map, pickupClusters, temporaryWalls, target, agent } = snapshot;
        const hasMap = map.width > 0 && map.height > 0;
        elements.map.classList.toggle("ready", hasMap);
        elements.emptyState.classList.toggle("hidden", hasMap);
        elements.mapTitle.textContent = hasMap ? `${agent.name}'s believed map` : "Waiting for map";
        elements.mapSize.textContent = `${map.width} × ${map.height}`;
        elements.clusterSummary.textContent = pickupClusters.length
            ? `${pickupClusters.length} cluster${pickupClusters.length === 1 ? "" : "s"} · striped means unvisited`
            : "No pickup clusters yet";
        if (!hasMap) {
            elements.map.replaceChildren();
            return;
        }

        elements.map.style.setProperty("--map-width", map.width);
        elements.map.style.setProperty("--map-height", map.height);

        const clustersByCell = new Map();
        const visitedCount = pickupClusters.filter(
            (cluster) => cluster.visitOrder !== undefined,
        ).length;
        for (const cluster of pickupClusters) {
            for (const cell of cluster.cells) {
                clustersByCell.set(positionKey(cell), cluster);
            }
        }
        const temporaryWallKeys = new Set(temporaryWalls.map(positionKey));
        const targetKey = target ? positionKey(target.position) : undefined;
        const agentKey = positionKey({
            x: Math.round(agent.position.x),
            y: Math.round(agent.position.y),
        });
        const fragment = document.createDocumentFragment();

        for (let y = map.height - 1; y >= 0; y -= 1) {
            for (let x = 0; x < map.width; x += 1) {
                const cell = document.createElement("div");
                const tileType = String(map.tiles[x]?.[y] ?? "0");
                const key = `${x},${y}`;
                cell.className = `cell tile-${tileType}`;
                cell.dataset.position = key;
                cell.title = `(${x}, ${y}) · ${tileLabel(tileType)}`;

                const cluster = clustersByCell.get(key);
                if (cluster) {
                    cell.classList.add("pickup-cluster");
                    if (cluster.visitOrder === undefined) {
                        cell.classList.add("cluster-unvisited");
                    } else {
                        cell.style.setProperty(
                            "--cluster-color",
                            clusterColor(cluster.visitOrder, visitedCount),
                        );
                        cell.title += ` · cluster visit #${cluster.visitOrder + 1}`;
                    }
                    if (cluster.active) {
                        cell.classList.add("cluster-active");
                    }
                }
                if (key === agentKey && agent.id) {
                    cell.append(makeMarker("agent-marker", "A"));
                }
                if (temporaryWallKeys.has(key)) {
                    cell.append(makeMarker("temporary-wall", "×"));
                    cell.title += " · temporary wall";
                }
                if (key === targetKey) {
                    cell.classList.add("target-cell");
                    cell.append(makeMarker("target-marker"));
                    cell.title += ` · ${target.intention} target`;
                }
                fragment.append(cell);
            }
        }
        elements.map.replaceChildren(fragment);
    }
}

function makeMarker(className, text = "") {
    const marker = document.createElement("span");
    marker.className = `marker ${className}`;
    marker.textContent = text;
    marker.setAttribute("aria-hidden", "true");
    return marker;
}

function positionKey(position) {
    return `${position.x},${position.y}`;
}

function formatPosition(position) {
    const x = Number.isInteger(position.x) ? position.x : position.x.toFixed(1);
    const y = Number.isInteger(position.y) ? position.y : position.y.toFixed(1);
    return `(${x}, ${y})`;
}

function clusterColor(visitOrder, visitedCount) {
    const progress = visitedCount <= 1 ? 1 : visitOrder / (visitedCount - 1);
    const saturation = 52 + progress * 38;
    const lightness = 18 + progress * 29;
    return `hsl(151 ${saturation}% ${lightness}%)`;
}

function tileLabel(tileType) {
    return {
        "0": "wall",
        "1": "pickup cell",
        "2": "drop cell",
        "3": "walkable cell",
        "4": "base cell",
        "5": "crate cell",
        "5!": "crate spawning cell",
    }[tileType] ?? "directional cell";
}

const renderer = new GhostMapRenderer();

async function refresh() {
    if (requestInFlight) {
        return;
    }
    requestInFlight = true;
    try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`State request failed: ${response.status}`);
        }
        renderer.render(await response.json());
    } catch (error) {
        elements.connection.className = "connection offline";
        elements.connectionLabel.textContent = "Ghost map offline";
        elements.lastUpdate.textContent = error instanceof Error
            ? error.message
            : "Unable to refresh";
    } finally {
        requestInFlight = false;
    }
}

void refresh();
window.setInterval(() => void refresh(), 350);
