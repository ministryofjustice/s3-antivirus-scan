import {
  S3Client,
  type S3ClientOptions,
} from "@bradenmacdonald/s3-lite-client";

import { s3Config } from "./config.ts";
import { Credentials, webIdentityTokenProvider } from "./aws.ts";

let cachedCredentials: Credentials | null = null;
let s3Client: S3Client | null = null;

async function getS3Client(): Promise<S3Client> {
  const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
  const now = new Date();

  const s3Config: S3ClientOptions = {
    endPoint: Deno.env.get("S3_ENDPOINT")!,
    region: Deno.env.get("S3_REGION")!,
    bucket: Deno.env.get("S3_BUCKET")!,
  };

  if (Deno.env.get("NODE_ENV") === "test") {
    return new S3Client({
      ...s3Config,
      accessKey: Deno.env.get("S3_ACCESS_KEY_ID"),
      secretKey: Deno.env.get("S3_SECRET_ACCESS_KEY"),
      pathStyle: true,
    });
  }

  // Check if we need new credentials
  if (!cachedCredentials || (now.getTime() + bufferTime) >= cachedCredentials.expiration.getTime()) {
    console.log("Refreshing AWS credentials...");
    cachedCredentials = await webIdentityTokenProvider();

    // Create new client with fresh credentials
    s3Client = new S3Client({
      ...s3Config,
      accessKey: cachedCredentials.accessKeyId,
      secretKey: cachedCredentials.secretAccessKey,
      sessionToken: cachedCredentials.sessionToken,
    });
  }

  return s3Client!;
}

export const getObjectsForScanning = async ({
  limit,
}: { limit?: number } = {}): Promise<Set<string>> => {
  // Create an empty set to hold files needing scanning
  const filesToScan = new Set<string>();

  for await (const obj of (await getS3Client()).listObjects()) {
    if (!obj.key) {
      console.log("Skipping object with no Key");
      continue;
    }

    filesToScan.add(obj.key);

    // If a limit is set and we've reached it, break out of the loop
    if (limit && filesToScan.size >= limit) {
      break;
    }
  }

  return filesToScan;
};

// Return readable stream for an object
export const getReadableStreamForObject = async (
  key: string,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null> => {
  const response = await (await getS3Client()).getObject(key);

  return response.body;
};
