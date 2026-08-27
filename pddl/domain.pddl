(define (domain deliveroo)
    (:requirements :strips :typing)
    (:types
        position
        agent
        parcel
    )
    (:predicates
        ; Players predicates
        (agent-at ?agent - agent ?pos - position)
        (carrying ?agent - agent ?id - parcel)

        ; Map predicates
        (upper-cell ?pos1 - position ?pos2 - position)
        (lower-cell ?pos1 - position ?pos2 - position)
        (left-cell  ?pos1 - position ?pos2 - position)
        (right-cell ?pos1 - position ?pos2 - position)

        ; Points of interest Predicates
        (pickUp-at ?pos - position)
        (parcel-at ?id - parcel ?pos - position)
        (delivery-at ?pos - position)

        (delivered ?id -parcel)
    )

    (:action move-up
        :parameters (?a - agent ?from ?to - position)
        :precondition (and (agent-at ?a ?from) (upper-cell ?from ?to))
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-down
        :parameters (?a - agent ?from ?to - position)
        :precondition (and (agent-at ?a ?from) (lower-cell ?from ?to))
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-left
        :parameters (?a - agent ?from ?to - position)
        :precondition (and (agent-at ?a ?from) (left-cell ?from ?to))
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-right
        :parameters (?a - agent ?from ?to - position)
        :precondition (and (agent-at ?a ?from) (right-cell ?from ?to))
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action pick-up
        :parameters (?a - agent ?p - parcel ?pos - position)
        :precondition (and (agent-at ?a ?pos) (parcel-at ?p ?pos) (pickUp-at ?pos))
        :effect (and (carrying ?a ?p) (not (parcel-at ?p ?pos)))
    )

    (:action deliver
        :parameters (?a - agent ?p - parcel ?pos - position)
        :precondition (and (agent-at ?a ?pos) (carrying ?a ?p) (delivery-at ?pos))
        :effect (and (not (carrying ?a ?p)) (delivered ?p))
    )
)