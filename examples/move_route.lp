// MoveTo (AnyLogic): agents travel to a `node` destination at `speed`
// (distance / speed), or spend an explicit `tripTime`; with neither they
// jump. Nodes are spatial markup with x/y coordinates.
model MoveRoute {
  node Depot {
    x = 10
    y = 0
  }
  source Jobs {
    arrival = rate(1.0)
  }
  moveTo Ship {
    node = Depot
    speed = 5.0
  }
  sink Done {
  }
  couple Jobs.out -> Ship.in
  couple Ship.out -> Done.in
}
