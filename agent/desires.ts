/**
 * This files contains the functions intended to take knowledge
 * relative to the world and convert it into Desires
 */

import agent from "./agent.js";
import { Position } from "./astar.js";
import beliefs, { Parcel } from "./beliefs.js";
import { DeliverParcelIntention, Intention, PickUpParcelIntention, SearchIntention } from "./intentions.js";
import { getClosestDeliveringCell } from "./utils.js";

export default function optionGeneration() {
    let intentions: Intention[] = [];

    beliefs.parcels.forEach((parcel: Parcel) => {
        if(!parcel.carriedBy) {
            intentions.push(new PickUpParcelIntention(parcel, new Position(parcel.x, parcel.y)));
        } else if (parcel.carriedBy === agent.id) {
            const closestDelivery = getClosestDeliveringCell(agent.position, beliefs.delivering_cells, beliefs.crates.values().next().value);

            if(closestDelivery)
                intentions.push(new DeliverParcelIntention(closestDelivery));
        }
    });

    if(intentions.length == 0) {
        intentions.push(new SearchIntention());
    }
}