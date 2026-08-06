// Resource task preemption (AnyLogic): a high-priority task (priority 5)
// preempts the running low-priority task, which exits through outPreempted.
model TaskPreempt {
  resource Server {
    capacity = 1
  }
  source Routine {
    arrival = rate(1.0)
    state priority: float = 1
  }
  source Urgent {
    arrival = rate(0.2)
    state priority: float = 5
  }
  service Handle {
    resource = Server
    time = constant(100.0)
    enablePreemption = true
    taskMayPreempt = true
    taskPreemptionPolicy = pp_terminate
  }
  sink Done {
  }
  sink Preempted {
  }
  couple Routine.out -> Handle.in
  couple Urgent.out -> Handle.in
  couple Handle.out -> Done.in
  couple Handle.outPreempted -> Preempted.in
}
