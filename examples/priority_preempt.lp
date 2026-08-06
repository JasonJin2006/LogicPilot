// Priority queue with preemption (AnyLogic semantics): agents are queued by
// priority (entity attribute "priority"), and a full queue ejects its
// weakest waiter through outPreempted when a higher-priority agent arrives.
model PriorityPreempt {
  source Urgent {
    arrival = rate(1.0)
    state priority: float = 5
  }
  source Normal {
    arrival = rate(1.0)
    state priority: float = 1
  }
  queue Buffer {
    capacity = 2
    queuing = queuing_priority
    enablePreemption = true
  }
  delay Work {
    delayTime = constant(5.0)
    capacity = 1
  }
  sink Done { }
  sink Dropped { }
  couple Urgent.out -> Buffer.in
  couple Normal.out -> Buffer.in
  couple Buffer.out -> Work.in
  couple Work.out -> Done.in
  couple Buffer.outPreempted -> Dropped.in
}
