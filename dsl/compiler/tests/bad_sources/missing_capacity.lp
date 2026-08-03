// CLI test fixture: resource is missing its required capacity field.
model Broken {
  resource Server {
  }

  process Flow {
    source Arrivals {
      arrival = poisson(0.8)
    }
    service Server {
      time = exponential(1.0)
    }
  }
}
