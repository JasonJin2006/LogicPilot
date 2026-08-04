// M/M/2 queue - multi-server visualization example.
//
// Two parallel servers (resource capacity = 2), Poisson arrivals at rate
// lambda = 1.6 and exponential service rate mu = 1.0 per server, so the
// offered load a = lambda / mu = 1.6 < c = 2 (stable). The web QueueView
// renders one service cell per server; in-service customers sit on their
// server cell.
model TwoServers {
  resource Server {
    capacity = 2
  }

  process Flow {
    source Arrivals {
      arrival = poisson(1.6)
    }
    queue WaitLine {
      capacity = 1000000
    }
    service Server {
      time = exponential(1.0)
    }
  }
}
