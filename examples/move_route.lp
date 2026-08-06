// MoveTo (AnyLogic): agents spend `tripTime` in the block, or travel
// |xYZ - current| / `speed` when speed is set; with neither they jump.
model MoveRoute {
  source Jobs {
    arrival = rate(1.0)
  }
  moveTo Ship {
    tripTime = 2.0
  }
  sink Done {
  }
  couple Jobs.out -> Ship.in
  couple Ship.out -> Done.in
}
