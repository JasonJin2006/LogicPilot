// Exit: removes agents from the process flow (AnyLogic Exit); sojourn is
// still recorded, and no agent continues downstream.
model FlowExit {
  source Jobs {
    arrival = rate(1.0)
  }
  delay Work {
    delayTime = constant(0.5)
    capacity = 1
  }
  exit Done {
  }
  couple Jobs.out -> Work.in
  couple Work.out -> Done.in
}
