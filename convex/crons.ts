import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Uploads that never made it into a grid are unreachable and would otherwise
// sit in storage forever. Daily is often enough — the sweep only touches files
// older than a day.
crons.daily(
  "sweep orphaned uploads",
  { hourUTC: 8, minuteUTC: 30 },
  internal.grids.sweepOrphanedUploads,
);

export default crons;
