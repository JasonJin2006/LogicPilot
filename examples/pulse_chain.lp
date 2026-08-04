// DEVS atomic pulse chain - milestone 1b example.
//
// Pulser is a perpetual emitter with a fixed 1.0 s time advance; each
// internal transition emits a pulse on port `pulse`, routed to Sink.on_input
// which flips state `seen` to true. The DEVS replication adapter interprets
// `--arrivals` as the internal-transition budget, so the run terminates
// deterministically: horizon ~= arrivals * 1.0 s, Sink.seen == true.
model PulseChain {
  atomic Pulser {
    time_advance = constant(1.0)
    on_timeout: emit pulse
  }

  atomic Sink {
    state seen = false
    on_input pulse: seen = true
  }

  couple Pulser.pulse -> Sink.pulse
}
