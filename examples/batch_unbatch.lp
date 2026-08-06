// Temporary batch: agents are grouped by the Batch block and restored to
// individual agents by Unbatch (AnyLogic semantics).
model BatchLine {
  source Parts {
    arrival = rate(2.0)
  }
  batch Group {
    batchSize = 3
    permanent = false
  }
  unbatch Split {
  }
  sink Done {
  }
  couple Parts.out -> Group.in
  couple Group.out -> Split.in
  couple Split.out -> Done.in
}
