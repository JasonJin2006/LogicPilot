// Traffic-light statechart: a pure timeout-driven cycle. Each state owns
// one outgoing timeout transition, so the machine cycles deterministically:
// Red (3s) -> Green (3s) -> Yellow (1s) -> Red ...
model TrafficLight {
  statechart Light {
    initial = Red
    state Red { }
    state Green { }
    state Yellow { }
    transition r_g { from = Red; to = Green; triggeredBy = timeout; timeout = 3.0 }
    transition g_y { from = Green; to = Yellow; triggeredBy = timeout; timeout = 3.0 }
    transition y_r { from = Yellow; to = Red; triggeredBy = timeout; timeout = 1.0 }
  }
}
