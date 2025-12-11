import { type S3ClientOptions } from "@bradenmacdonald/s3-lite-client";
import { webIdentityTokenProvider } from "./aws.ts";

// If we dont have the environment variables, we should throw an error
if (
  !Deno.env.get("S3_ENDPOINT") || !Deno.env.get("S3_REGION") ||
  !Deno.env.get("S3_BUCKET")
) {
  throw new Error("Missing required S3 environment variables");
}

const s3Config: S3ClientOptions = {
  endPoint: Deno.env.get("S3_ENDPOINT")!,
  region: Deno.env.get("S3_REGION")!,
  bucket: Deno.env.get("S3_BUCKET")!,
};

if (Deno.env.get("NODE_ENV") === "test") {
  s3Config.accessKey = Deno.env.get("S3_ACCESS_KEY_ID");
  s3Config.secretKey = Deno.env.get("S3_SECRET_ACCESS_KEY");
  s3Config.pathStyle = true;
} else {
  // In production, we assume the role via web identity
  const credentials = await webIdentityTokenProvider();

  s3Config.accessKey = credentials.accessKeyId;
  s3Config.secretKey = credentials.secretAccessKey;
  s3Config.sessionToken = credentials.sessionToken;
}

const failConfig = {
  // Config, for how to handle scan results, should certain conditions trigger non-zero exit codes?
  // Values default to true, unless explicitly set to "0", "false", "no", or "off"
  failOnSkipped: !["0", "false", "no", "off"].includes(
    (Deno.env.get("FAIL_ON_SKIPPED") || "").toLowerCase(),
  ),
  failOnError: !["0", "false", "no", "off"].includes(
    (Deno.env.get("FAIL_ON_SCAN_ERROR") || "").toLowerCase(),
  ),
  failOnInfected: !["0", "false", "no", "off"].includes(
    (Deno.env.get("FAIL_ON_INFECTED") || "").toLowerCase(),
  ),
  // Config the retry behavior
  retryBackoffSeconds: parseInt(Deno.env.get("RETRY_BACKOFF_SECONDS") || "2"),
  retryMaxAttempts: parseInt(Deno.env.get("RETRY_MAX_ATTEMPTS") || "3"),
};

export { failConfig, s3Config };
