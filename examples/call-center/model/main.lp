// CallCenter - project-format-v2 example project.
//
// The model root keeps leaf members (param / resource) and references its
// process container via an instance member; the container itself lives in
// model/scenes/CallFlow.lp (one file per container, carrying a stable uid).
model CallCenter {
  use process

  param arrival_rate: float = 0.8
  param service_rate: float = 1.0

  resource Agent {
    capacity = 2
    failure_rate = 0.02
  }

  instance CallFlow = "model/scenes/CallFlow.lp"
}
