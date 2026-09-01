// Level 3 Statechart case: two machines coupled by an emitted message.
// Sender times out at t=1 and emits `go`; Receiver consumes it in the same
// simulation instant and reaches Done.
model MessageRelay {
  statechart Sender {
    initial = Idle
    state Idle { }
    state Sent { }
    transition send {
      from = Idle
      to = Sent
      triggeredBy = timeout
      timeout = 1.0
      guard = "t >= 1.0"
      action = "emit go"
    }
  }

  statechart Receiver {
    initial = Waiting
    state Waiting { }
    state Done { }
    transition receive {
      from = Waiting
      to = Done
      triggeredBy = message
      messageType = go
    }
  }

  couple Sender.go -> Receiver.go
}
