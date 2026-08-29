(define (domain deliveroo)
    (:requirements :strips :typing)
    (:types
        position agent
    )
    (:predicates
        ; Player predicates
        (agent-at ?agent - agent ?pos - position)

        ; Map predicates
        (upper-cell ?pos1 - position ?pos2 - position)
        (lower-cell ?pos1 - position ?pos2 - position)
        (left-cell ?pos1 - position ?pos2 - position)
        (right-cell ?pos1 - position ?pos2 - position)

        (crate-at ?pos - position)
        (crate-free ?pos - position)
        (crate-cell ?position)
    )

    (:action move-up
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (upper-cell ?from ?to)
            (crate-free ?to)
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-down
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (lower-cell ?from ?to)
            (crate-free ?to)
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-left
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (left-cell ?from ?to)
            (crate-free ?to)
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-right
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (right-cell ?from ?to)
            (crate-free ?to)
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action crate-move-up
        :parameters (?a - agent ?from ?to ?crate_to - position)
        :precondition (and
            (agent-at ?a ?from)
            (upper-cell ?from ?to)
            (upper-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?to)
            (crate-free ?crate_to)
        )
        :effect (and
            (not (agent-at ?a ?from))
            (agent-at ?a ?to)
            (not (crate-at ?to))
            (crate-at ?crate_to)
            (crate-free ?to)
            (not (crate-free ?crate_to))
        )
    )

    (:action crate-move-down
        :parameters (?a - agent ?from ?to ?crate_to - position)
        :precondition (and
            (agent-at ?a ?from)
            (lower-cell ?from ?to)
            (lower-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?to)
            (crate-free ?crate_to)
        )
        :effect (and
            (not (agent-at ?a ?from))
            (agent-at ?a ?to)
            (not (crate-at ?to))
            (crate-at ?crate_to)
            (crate-free ?to)
            (not (crate-free ?crate_to))
        )
    )

    (:action crate-move-left
        :parameters (?a - agent ?from ?to ?crate_to - position)
        :precondition (and
            (agent-at ?a ?from)
            (left-cell ?from ?to)
            (left-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?to)
            (crate-free ?crate_to)
        )
        :effect (and
            (not (agent-at ?a ?from))
            (agent-at ?a ?to)
            (not (crate-at ?to))
            (crate-at ?crate_to)
            (crate-free ?to)
            (not (crate-free ?crate_to))
        )
    )

    (:action crate-move-right
        :parameters (?a - agent ?from ?to ?crate_to - position)
        :precondition (and
            (agent-at ?a ?from)
            (right-cell ?from ?to)
            (right-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?to)
            (crate-free ?crate_to)
        )
        :effect (and
            (not (agent-at ?a ?from))
            (agent-at ?a ?to)
            (not (crate-at ?to))
            (crate-at ?crate_to)
            (crate-free ?to)
            (not (crate-free ?crate_to))
        )
    )

)
