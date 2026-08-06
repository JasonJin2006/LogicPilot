// MoveTo (AnyLogic): agents travel to a `node` destination along the path
// network's shortest route at `speed` (network distance / speed).
model MoveRoute {
  node Dock {
    x = 0
    y = 0
  }
  node Depot {
    x = 10
    y = 0
  }
  node Bay {
    x = 10
    y = 10
  }
  path Run1 {
    node1 = Dock
    node2 = Depot
  }
  path Run2 {
    node1 = Depot
    node2 = Bay
  }
  source Jobs {
    arrival = rate(1.0)
  }
  moveTo Ship {
    node = Bay
    speed = 10.0
  }
  sink Done {
  }
  couple Jobs.out -> Ship.in
  couple Ship.out -> Done.in
}
