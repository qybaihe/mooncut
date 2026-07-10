import {resolve} from "node:path";
import {config} from "./config.ts";
import {listGatewayModels} from "./gateway.ts";
import {jobManager} from "./jobs.ts";
import {startServer} from "./server.ts";

const [command = "serve", ...args] = process.argv.slice(2);

if (command === "serve") {
  await startServer();
} else if (command === "models") {
  const models = await listGatewayModels();
  console.log(JSON.stringify({
    gateway: config.gatewayBaseUrl,
    available: models,
    routing: {planner: config.plannerModel, vision: config.visionModels},
  }, null, 2));
} else if (command === "edit") {
  const input = args[0];
  if (!input) throw new Error("Usage: npm run edit -- /absolute/path/video.mp4 [prompt]");
  const job = await jobManager.create({
    inputPath: resolve(input),
    prompt: args.slice(1).join(" ") || undefined,
  });
  console.log(`Queued ${job.id}`);
  const completed = await jobManager.wait(job.id);
  console.log(JSON.stringify(completed, null, 2));
  if (completed.status !== "completed") process.exitCode = 1;
} else {
  throw new Error(`Unknown command: ${command}`);
}
