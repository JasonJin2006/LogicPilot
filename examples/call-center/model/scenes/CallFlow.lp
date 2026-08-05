// @uid lp_bb589d32b05e296b
  process CallFlow {
    source Incoming {
      arrival = rate(arrival_rate)
    }
    queue Wait {
      capacity = 100
    }
    service Handle {
      resource = Agent
      time = exponential(service_rate)
    }
    sink Done { }
  }
