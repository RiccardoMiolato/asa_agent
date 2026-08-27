# ASA agents: Deliveroo.js server protocol

This document describes what an autonomous agent receives from the Deliveroo.js server and how it can act on the environment. It is intended both for developers and for AI coding agents working on this repository in the future.

The information below was verified against the local Deliveroo.js backend (`2.5.1`) and SDK (`1.3.10`). If those dependencies are upgraded, re-check the authoritative sources:

- `../Deliveroo.js/backend/src/ioServer.js`: when the server emits events and handles actions.
- `../Deliveroo.js/backend/src/deliveroo/Sensor.js`: sensing timing, range, and payload construction.
- `../Deliveroo.js/packages/@unitn-asa/deliveroo-js-sdk/src/client/DjsClientSocket.js`: client convenience methods.
- `../Deliveroo.js/packages/@unitn-asa/deliveroo-js-sdk/src/types/IOSocketEvents.js`: event declarations.

These are not three separate APIs. They are three views of the same Socket.io protocol: its declaration, client wrapper, and server implementation.

## Connection

Create a client with the SDK:

```ts
import { DjsConnect, DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";

const host = process.env.HOST ?? "http://localhost:8080";
const token = process.env.TOKEN ?? "";
const name = process.env.NAME ?? "agent";

const socket: DjsClientSocket = DjsConnect(host, token, name);
```

For guaranteed listener registration before any server event, disable auto-connect, install the listeners, and connect explicitly:

```ts
const socket: DjsClientSocket = DjsConnect(
  host,
  token,
  token ? undefined : name,
  false,
);

socket.onConfig(handleConfig);
socket.onMap(handleMap);
socket.onTile(handleTile);
socket.onYou(handleYou);
socket.onSensing(handleSensing);
socket.onMsg(handleMessage);

socket.connect();
```

A token determines the physical agent's stable `id`, name, team, and role. The BDI and LLM agents must use different tokens. Reusing one token makes two programs control the same physical agent, and overlapping actions may be penalized.

## Initial server events

On a new connection, the current server sends approximately:

```text
connect
token
config
tile, tile, tile, ...
map
controller, controller, ...
you
sensing
ping, ping, ...
```

Do not make correctness depend on this exact ordering. Maintain readiness flags for the state required by the agent, for example `configReady`, `mapReady`, and `selfReady`.

## `config`: game rules and full configuration

```ts
socket.onConfig((config) => {
  // Save relevant game rules.
});
```

Relevant payload shape:

```ts
interface Config {
  CLOCK: number;          // server frame interval in milliseconds
  PENALTY: number;
  AGENT_TIMEOUT: number;  // delay before deleting a disconnected agent
  BROADCAST_LOGS: boolean;
  GAME: {
    title: string;
    description: string;
    maxPlayers: number;
    map: {
      width: number;
      height: number;
      tiles: string[][];  // indexed as tiles[x][y]
    };
    parcels: {
      generation_event: string;
      decaying_event: string;
      max: number;
      reward_avg: number;
      reward_variance: number;
    };
    player: {
      movement_duration: number;
      observation_distance: number; // -1 means unlimited
      capacity: number;
    };
  };
}
```

The first index of `GAME.map.tiles` is `x`, and the second is `y`: `tiles[x][y]`. This is different from the conventional `matrix[row][column]` interpretation.

## `map` and `tile`: static environment

### Complete initial map

```ts
socket.onMap((maxX, maxY, tiles) => {
  // tiles: Array<{ x: number; y: number; type: string }>
});
```

In the current backend, `maxX` and `maxY` are maximum zero-based coordinates, not tile counts. A 25 by 25 map sends `maxX = 24` and `maxY = 24`.

### Individual tile updates

```ts
socket.onTile(({ x, y, type }) => {
  // Insert or replace this tile in the local map.
});
```

During connection the server emits every tile individually and then emits the bulk `map`. Later, administrator-driven tile changes arrive through `tile`. A full runtime map replacement can produce new `config` and many `tile` events; do not assume that a new bulk `map` event will always follow.

Tile types:

| Type | Meaning |
| --- | --- |
| `"0"` | Wall; not walkable |
| `"1"` | Walkable parcel-spawning tile |
| `"2"` | Walkable delivery tile |
| `"3"` | Ordinary walkable tile |
| `"4"` | Base tile; currently walkable |
| `"5"` | Walkable tile onto which a crate can be pushed |
| `"5!"` | Crate-spawning tile |
| `"↑"`, `"→"`, `"↓"`, `"←"` | Directional-entry restriction |

The complete map is global knowledge. `observation_distance` limits dynamic sensing, not access to the tile layout.

## `you`: authoritative state of this agent

```ts
interface SelfState {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  x?: number;
  y?: number;
  score: number;
  penalty: number;
}

socket.onYou((you: SelfState) => {
  // Replace the locally stored self state.
});
```

`you` is emitted initially and after changes to position, score, or penalty. The payload omits the inventory. Infer carried parcels from `sensing.parcels` entries whose `carriedBy` equals this agent's `id`; pickup and non-delivery putdown are observed through `sensing`, not through an inventory field in `you`.

Coordinates can be fractional while an animated movement is in progress. The resolved value of `await socket.emitMove(...)` and the final `you` update contain the final position.

## `sensing`: dynamic local perception

```ts
interface Sensing {
  positions: Array<{ x: number; y: number }>;
  agents: Array<{
    id: string;
    name: string;
    teamId: string;
    teamName: string;
    x: number;
    y: number;
    score: number;
    penalty: number;
  }>;
  parcels: Array<{
    id: string;
    x: number;
    y: number;
    carriedBy: string | null;
    reward: number;
  }>;
  crates: Array<{
    id: string;
    x: number;
    y: number;
  }>;
}

socket.onSensing((sensing: Sensing) => {
  // Update the deterministic world model; do not call an LLM here by default.
});
```

Semantics:

- The first snapshot is computed immediately during connection setup.
- The simulation is real-time, not turn-based.
- `CLOCK` is normally 50 ms, so the server has approximately 20 frames per second.
- A relevant state change marks the sensor as dirty.
- On the next server frame, a dirty sensor computes and emits one complete snapshot.
- Nothing is emitted on frames where the sensor is not dirty.
- Multiple changes before the next frame are coalesced into one snapshot.
- Arrival time also includes scheduling and network latency; events are not exactly periodic.
- Observation uses Manhattan distance. Walls do not block vision.
- `positions` lists the coordinates currently covered by the snapshot.
- `agents` excludes the receiving agent itself.
- `observation_distance === -1` provides unlimited observation.

Typical dirtying changes include movement of this agent, nearby agent movement or score changes, and visible parcel or crate creation, movement, reward change, pickup, drop, delivery, or deletion.

Each event is a current local snapshot, not a delta. Absence does not always mean deletion: an entity may have moved outside the observation area. Before deleting a remembered entity, check whether its last known coordinate appears in `positions`. Otherwise retain it as stale or uncertain knowledge.

The current API event is named `sensing`. Older course material mentioning separate `agentsSensing` and `parcelsSensing` events is not authoritative for this server version.

## `controller`: connected-agent directory

```ts
socket.onAgentConnected((status, agent) => {
  // status: "connected" | "disconnected"
  // agent: { id, name, teamId, teamName, score }
});
```

This event announces existing, newly connected, and disconnected agents. It does not provide positions. Nearby positions come from `sensing.agents`. Matching `teamId` can help identify a teammate, although an explicitly configured teammate ID is safer.

## `msg`: missions and agent communication

```ts
socket.onMsg((senderId, senderName, message, reply) => {
  // `reply` is optional and exists when the sender used `ask`.
});
```

There is no dedicated mission event or mission state in the server protocol. Natural-language special missions arrive as ordinary `msg` events. The LLM agent must classify them, retain the sender ID, store persistent strategy changes, and track mission completion itself.

Communication actions:

```ts
await socket.emitSay(recipientId, message);
const reply = await socket.emitAsk(recipientId, message);
await socket.emitShout(message);
```

Important details:

- `say` is one-way and its `"successful"` acknowledgement is not proof that a recipient received the message.
- `ask` waits for the first reply but has a hard-coded one-second timeout.
- An LLM response may take longer than one second. Prefer an immediate acknowledgement followed by a later `say`, or use correlated asynchronous `say` messages.
- `shout` broadcasts to every other connected socket, not only teammates.
- Use structured messages between the BDI and LLM agents, for example `{ type, missionId, payload }`.

## Other incoming events

- `connect`: Socket.io connection established.
- `disconnect`: connection lost. The physical agent is deleted after `AGENT_TIMEOUT` if it does not reconnect.
- `token`: signed identity token issued by the server.
- `ping`: latency probe; `DjsConnect` acknowledges it automatically.
- `metrics`: administrator-only performance metrics.
- `log`: optional diagnostics when server log broadcasting is enabled.

## Actions sent to the server

### Move

```ts
const result = await socket.emitMove("up");
// { x, y } on success; false on failure
```

Valid directions and coordinate effects:

- `up`: `y + 1`
- `down`: `y - 1`
- `right`: `x + 1`
- `left`: `x - 1`

Movement can fail because of a wall, locked destination, another agent, crate restrictions, directional restriction, invalid direction, or overlapping action.

### Pick up

```ts
const picked = await socket.emitPickup();
```

Pickup attempts to collect all free parcels on the current rounded tile. It does not accept selected IDs. The checked-in backend advertises `player.capacity` but does not enforce it for ordinary player pickup; do not rely on that discrepancy being present on another server version.

### Put down or deliver

```ts
const allDropped = await socket.emitPutdown();
const selectedDropped = await socket.emitPutdown(["p1", "p2"]);
```

On a delivery tile, dropped parcels are deleted and their current rewards are added to the agent's score. On other walkable tiles, they remain on the ground.

### Sequential-action rule

An agent has a per-agent action mutex. Always await actions sequentially:

```ts
await socket.emitMove("right");
await socket.emitMove("up");
await socket.emitPickup();
```

Do not fire overlapping actions. A concurrent action fails and can reduce the agent's penalty score. Different physical agents can act concurrently; there is no global turn order.

The SDK applies a one-second acknowledgement timeout to `move`, `pickup`, and `putdown`, so action errors and timeouts must be handled.

## Recommended local state architecture

Keep networking, deterministic state, deliberation, and execution separate:

```text
Socket.io events
      -> deterministic world model
      -> BDI/LLM decision logic
      -> validated action or communication tools
      -> sequential Socket.io actions
```

Recommended state:

- Immutable/current map keyed by `"x,y"` plus incremental `tile` updates.
- Authoritative self state from `you`.
- Visible dynamic snapshot from `sensing`.
- Stale/uncertain memory for entities outside the sensing area.
- Known agents and teammate IDs from `controller` and `sensing`.
- Current inventory inferred from parcels with `carriedBy === self.id`.
- Mission queue and persistent strategy constraints parsed from `msg`.
- Serialized action queue so only one action is in flight per physical agent.

Do not invoke an LLM for every `sensing` event. Update local state cheaply and invoke the LLM at meaningful decision points: a mission arrives, the current plan fails, a mission completes, or an important world change invalidates the plan.
