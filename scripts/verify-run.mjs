#!/usr/bin/env node
// Runtime verifier (P1): checks a replication's metrics.json against
// invariant checks, plus an optional theory contract (expect.json, same
// shape as examples/mm1.expect.json). Prints a machine-readable report.
//
// Usage:
//   node scripts/verify-run.mjs <metrics.json> [expect.json] [--strict]
//
// Invariant checks (always run):
//   summary-present     metrics.json has a finite summary block
//   replications-finite every replication row is finite
//   conservation        0 <= departures <= arrivals per replication
//   throughput-positive summary throughput mean > 0
// With an expect.json theory contract:
//   theory-Wq           CI covers theory.wq OR
//                       |Wq - theory.wq| <= point_estimate_abs_tol
//   theory-throughput   |throughput - theory.throughput| <=
//                       throughput_rel_tol * theory.throughput
import { readFileSync } from 'node:fs';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function check(name, passed, detail) {
  return { name, passed, detail };
}

function verify(metrics, theory, strict) {
  const checks = [];
  const summary = metrics.summary;

  // summary-present
  const summaryOk =
    summary && Object.values(summary).every((field) => finite(field.mean));
  checks.push(check(
    'summary-present',
    summaryOk,
    summaryOk ? '' : 'metrics.json summary is missing or non-finite',
  ));

  // replications-finite
  const reps = Array.isArray(metrics.replications) ? metrics.replications : [];
  const repsFinite = reps.every(
    (rep) =>
      finite(rep.arrivals) &&
      finite(rep.departures) &&
      finite(rep.throughput) &&
      finite(rep.W) &&
      finite(rep.Wq),
  );
  checks.push(check(
    'replications-finite',
    repsFinite,
    repsFinite ? '' : 'one or more replication rows are non-finite',
  ));

  // conservation: no replication may report more departures than arrivals.
  const conservationOk = reps.every(
    (rep) => rep.departures >= 0 && rep.departures <= rep.arrivals,
  );
  checks.push(check(
    'conservation',
    conservationOk,
    conservationOk
      ? ''
      : 'a replication reported departures > arrivals or negative departures',
  ));

  // throughput-positive: the model actually executed.
  const throughputOk =
    summary && finite(summary.throughput.mean) && summary.throughput.mean > 0;
  checks.push(check(
    'throughput-positive',
    throughputOk,
    throughputOk ? '' : 'summary throughput mean is not positive',
  ));

  // Optional theory contract.
  if (theory && summary) {
    const pointTol = theory.acceptance?.point_estimate_abs_tol ?? 0.0;
    const relTol = theory.acceptance?.throughput_rel_tol ?? 0.0;
    const theoryWq = theory.theory?.wq;
    const theoryThroughput = theory.theory?.throughput;
    if (finite(theoryWq)) {
      // Acceptance rule mirrors examples/*.expect.json: the cross-
      // replication CI covering theory passes even when the point estimate
      // strays (small samples), otherwise the point estimate must be within
      // the absolute tolerance.
      const ciCovers =
        finite(summary.Wq.ci_low) &&
        finite(summary.Wq.ci_high) &&
        theoryWq >= summary.Wq.ci_low &&
        theoryWq <= summary.Wq.ci_high;
      const pointOk = Math.abs(summary.Wq.mean - theoryWq) <= pointTol;
      const wqOk = ciCovers || pointOk;
      checks.push(check(
        'theory-Wq',
        wqOk,
        ciCovers
          ? `CI [${summary.Wq.ci_low}, ${summary.Wq.ci_high}] covers ${theoryWq}`
          : `|${summary.Wq.mean} - ${theoryWq}| <= ${pointTol}`,
      ));
    }
    if (finite(theoryThroughput) && theoryThroughput > 0) {
      const tOk =
        Math.abs(summary.throughput.mean - theoryThroughput) <=
        relTol * theoryThroughput;
      checks.push(check(
        'theory-throughput',
        tOk,
        `|${summary.throughput.mean} - ${theoryThroughput}| <= ` +
          `${relTol * theoryThroughput}`,
      ));
    }
  }

  const failures = checks.filter((entry) => !entry.passed);
  return {
    ok: failures.length === 0,
    checks,
    failed: failures.map((entry) => entry.name),
  };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const paths = args.filter((arg) => arg !== '--strict');
  if (paths.length < 1 || paths.length > 2) {
    console.error(
      'usage: node scripts/verify-run.mjs <metrics.json> [expect.json] [--strict]',
    );
    process.exit(2);
  }
  let metrics;
  try {
    metrics = JSON.parse(readFileSync(paths[0], 'utf8'));
  } catch (error) {
    console.error(`cannot read metrics.json '${paths[0]}': ${error.message}`);
    process.exit(2);
  }
  let theory = null;
  if (paths.length === 2) {
    try {
      theory = JSON.parse(readFileSync(paths[1], 'utf8'));
    } catch (error) {
      console.error(`cannot read expect.json '${paths[1]}': ${error.message}`);
      process.exit(2);
    }
  }
  const report = verify(metrics, theory, strict);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

main();
