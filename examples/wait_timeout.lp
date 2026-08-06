// Exit-on-timeout (AnyLogic Wait semantics): agents that wait longer than
// `timeout` in the Wait block leave through outTimeout instead of out. The
// slow one-slot delay keeps the wait occupied, so most agents time out.
model WaitTimeout {
  source Jobs {
    arrival = rate(2.0)
  }
  wait Buffer {
    capacity = 100
    enableTimeout = true
    timeout = 1.0
  }
  delay Work {
    delayTime = constant(5.0)
    capacity = 1
  }
  sink Done { }
  sink Late { }
  couple Jobs.out -> Buffer.in
  couple Buffer.out -> Work.in
  couple Work.out -> Done.in
  couple Buffer.outTimeout -> Late.in
}
