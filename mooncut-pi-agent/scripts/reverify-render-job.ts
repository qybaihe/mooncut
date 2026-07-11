import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {readFile, rename, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {config, jobsRoot} from "../src/config.ts";
import {probeVideo} from "../src/media.ts";
import {reviewRenderedVideo} from "../src/quality.ts";
import type {ArtifactMap, EditJobRecord, AgentEditSpec} from "../src/types.ts";

const jobId = process.argv[2];
if (!jobId || !/^[a-f0-9]{16,64}$/u.test(jobId)) {
  throw new Error("Usage: node scripts/reverify-render-job.ts <hex-job-id>");
}

const jobDir = join(jobsRoot, jobId);
const jobPath = join(jobDir, "job.json");
const videoPath = join(jobDir, "final.mp4");
const specPath = join(jobDir, "edit-spec.json");
if (!existsSync(jobPath) || !existsSync(videoPath) || !existsSync(specPath)) {
  throw new Error("The job must contain job.json, edit-spec.json, and final.mp4");
}

const job = JSON.parse(await readFile(jobPath, "utf8")) as EditJobRecord;
const spec = JSON.parse(await readFile(specPath, "utf8")) as AgentEditSpec;
const quality = await reviewRenderedVideo({
  jobDir,
  requestPrompt: job.request.prompt ?? "",
  spec,
  videoPath,
});
const probe = await probeVideo(videoPath);
const expectedDurationMs = Math.round(spec.durationInFrames / spec.fps * 1000);
const verification = {
  ok: quality.ok,
  video: videoPath,
  contactSheet: join(jobDir, "final-contact-sheet.jpg"),
  probe,
  expectedDurationMs,
  qualityReview: quality,
};
await writeFile(join(jobDir, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
if (!quality.ok) {
  throw new Error(`The refreshed visual quality review still failed: ${quality.findings.map((finding) => finding.id).join(", ")}`);
}

const summaryPath = join(jobDir, "agent-summary.txt");
await writeFile(summaryPath, "MoonCut render passed a refreshed visual quality review without rerendering.\n");
const candidates: Array<[keyof ArtifactMap, string]> = [
  ["video", videoPath],
  ["editSpec", specPath],
  ["subtitles", join(jobDir, "subtitles.json")],
  ["faceTrack", join(jobDir, "face-track.json")],
  ["sourceInspection", join(jobDir, "source-inspection.json")],
  ["sourceContactSheet", join(jobDir, "source-contact-sheet.jpg")],
  ["finalContactSheet", join(jobDir, "final-contact-sheet.jpg")],
  ["verification", join(jobDir, "verification.json")],
  ["renderProps", join(jobDir, "render-props.json")],
  ["renderLog", join(jobDir, "render.log")],
  ["agentSummary", summaryPath],
  ["qualityReview", join(jobDir, "quality-review.json")],
];
const artifacts = Object.fromEntries(candidates.filter(([, path]) => existsSync(path))) as ArtifactMap;
job.status = "completed";
job.stage = "completed";
job.progress = 1;
job.error = undefined;
job.result = {
  summary: "MoonCut render verified after the visual quality-gate correction.",
  artifacts,
  probe,
  models: {planner: config.plannerModel, vision: "quality-only-reverification"},
  quality,
};
job.updatedAt = new Date().toISOString();
const temporaryPath = `${jobPath}.reverify-${randomUUID()}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(job, null, 2)}\n`);
await rename(temporaryPath, jobPath);
console.log(JSON.stringify({id: job.id, status: job.status, verification: quality.ok, probe, artifacts: Object.keys(artifacts)}, null, 2));
