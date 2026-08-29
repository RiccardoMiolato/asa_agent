(define (domain deliveroo)
    (:requirements :adl)
    (:types
        position agent crate
    )
    (:predicates
        ; Player predicates
        (agent-at ?agent - agent ?pos - position)

        ; Map predicates
        (upper-cell ?pos1 - position ?pos2 - position)
        (lower-cell ?pos1 - position ?pos2 - position)
        (left-cell ?pos1 - position ?pos2 - position)
        (right-cell ?pos1 - position ?pos2 - position)

        (crate-at ?crate - crate ?pos - position)
        (crate-cell ?position)
    )

    (:action move-up
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (upper-cell ?from ?to)
            (forall
                (?c - crate)
                (not (crate-at ?c ?to)))
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-down
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (lower-cell ?from ?to)
            (forall
                (?c - crate)
                (not (crate-at ?c ?to)))
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-left
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (left-cell ?from ?to)
            (forall
                (?c - crate)
                (not (crate-at ?c ?to)))
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action move-right
        :parameters (?a - agent ?from ?to - position)
        :precondition (and
            (agent-at ?a ?from)
            (right-cell ?from ?to)
            (forall
                (?c - crate)
                (not (crate-at ?c ?to)))
        )
        :effect (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
    )

    (:action crate-move-up
        :parameters (?a - agent ?from ?to ?crate_to - position ?c - crate)
        :precondition (and
            (agent-at ?a ?from)
            (upper-cell ?from ?to)
            (upper-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?c ?to)
            (forall
                (?c2 - crate)
                (not (crate-at ?c2 ?crate_to)))
        )
        :effect (and
            (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
            (and (crate-at ?c ?crate_to) (not (crate-at ?c ?to)))
        )
    )

    (:action crate-move-down
        :parameters (?a - agent ?from ?to ?crate_to - position ?c - crate)
        :precondition (and
            (agent-at ?a ?from)
            (lower-cell ?from ?to)
            (lower-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?c ?to)
            (forall
                (?c2 - crate)
                (not (crate-at ?c2 ?crate_to)))
        )
        :effect (and
            (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
            (and (crate-at ?c ?crate_to) (not (crate-at ?c ?to)))
        )
    )

    (:action crate-move-left
        :parameters (?a - agent ?from ?to ?crate_to - position ?c - crate)
        :precondition (and
            (agent-at ?a ?from)
            (left-cell ?from ?to)
            (left-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?c ?to)
            (forall
                (?c2 - crate)
                (not (crate-at ?c2 ?crate_to)))
        )
        :effect (and
            (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
            (and (crate-at ?c ?crate_to) (not (crate-at ?c ?to)))
        )
    )

    (:action crate-move-right
        :parameters (?a - agent ?from ?to ?crate_to - position ?c - crate)
        :precondition (and
            (agent-at ?a ?from)
            (right-cell ?from ?to)
            (right-cell ?to ?crate_to)
            (crate-cell ?crate_to)
            (crate-at ?c ?to)
            (forall
                (?c2 - crate)
                (not (crate-at ?c2 ?crate_to)))
        )
        :effect (and
            (and (agent-at ?a ?to) (not (agent-at ?a ?from)))
            (and (crate-at ?c ?crate_to) (not (crate-at ?c ?to)))
        )
    )

)
