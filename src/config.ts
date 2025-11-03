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

export { s3Config };
