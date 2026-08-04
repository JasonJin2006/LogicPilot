// CLI test fixture: the service's explicit resource reference is not
// declared (Phase C: `service { resource = R }` replaces same-name magic).
model Broken {
  resource Machine {
    capacity = 1
  }

  process Flow {
    source Arrivals {
      arrival = poisson(0.8)
    }
    service Worker {
      resource = Missing
      time = exponential(1.0)
    }
  }
}
