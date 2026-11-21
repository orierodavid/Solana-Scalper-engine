import "dotenv/config";
import { runReadOnlyScan } from "./scan-once.ts";

runReadOnlyScan().catch(() => {
  console.error("Read-only discovery and quote scan failed. No trades were submitted.");
  process.exitCode = 1;
});
