// CLI test fixture: resource carries an unknown field (LP2005). The
// catalog-driven process library gives every registered field a default,
// so "missing required field" no longer occurs in the standard library.
model Broken {
  resource Server {
    bogus_field = 1
  }

  source Arrivals {
    arrival = poisson(0.8)
  }
  service Server {
    time = exponential(1.0)
  }
}
