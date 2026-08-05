// CLI test fixture: the service references a resource that is not declared.
model Broken {
  resource Machine {
    capacity = 1
  }

  source Arrivals {
    arrival = poisson(0.8)
  }
  service Worker {
    time = exponential(1.0)
  }
}
