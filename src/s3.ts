import {
  S3Client,
  type S3ClientOptions,
} from "@bradenmacdonald/s3-lite-client";

import { Credentials, webIdentityTokenProvider } from "./aws.ts";

// If we dont have the environment variables, we should throw an error
if (
  !Deno.env.get("S3_ENDPOINT") || !Deno.env.get("S3_REGION") ||
  !Deno.env.get("S3_BUCKET")
) {
  throw new Error("Missing required S3 environment variables");
}

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
    if (
      !Deno.env.get("S3_ACCESS_KEY_ID") ||
      !Deno.env.get("S3_SECRET_ACCESS_KEY")
    ) {
      throw new Error("Missing required S3 environment variables");
    }

    return new S3Client({
      ...s3Config,
      accessKey: Deno.env.get("S3_ACCESS_KEY_ID"),
      secretKey: Deno.env.get("S3_SECRET_ACCESS_KEY"),
      pathStyle: true,
    });
  }

  // Check if we need new credentials
  if (
    !cachedCredentials ||
    (now.getTime() + bufferTime) >= cachedCredentials.expiration.getTime()
  ) {
    console.log("Refreshing AWS credentials...");
    console.log({ s3Config });
    cachedCredentials = await webIdentityTokenProvider();

    // Create new client with fresh credentials
    s3Client = new S3Client({
      ...s3Config,
      accessKey: cachedCredentials.accessKeyId,
      secretKey: cachedCredentials.secretAccessKey,
      sessionToken: cachedCredentials.sessionToken,
      pathStyle: false,
    });
  }

  return s3Client!;
}

export const getObjectsForScanning = async ({
  limit,
  maxFileSize = 25 * 1024 * 1024, // 25MB default ClamAV INSTREAM limit
}: { limit?: number; maxFileSize?: number } = {}): Promise<Set<string>> => {
  // Create an empty set to hold files needing scanning
  const filesToScan = new Set<string>();

  const client = await getS3Client();
  console.log(`Listing objects in bucket: ${Deno.env.get("S3_BUCKET")}`);

  for await (const obj of client.listObjects()) {
    if (!obj.key) {
      console.log("Skipping object with no Key");
      continue;
    }

    // Skip folder-like objects (keys ending with '/')
    if (obj.key.endsWith("/")) {
      console.log(`Skipping folder-like object: ${obj.key}`);
      continue;
    }

    // Skip files that are too large for ClamAV INSTREAM
    if (obj.size && obj.size > maxFileSize) {
      console.log(
        `Skipping large file: ${obj.key} (${obj.size} bytes, max: ${maxFileSize})`,
      );
      continue;
    }

    console.log(
      `Found object for scanning: ${obj.key} (${obj.size || "unknown"} bytes)`,
    );
    filesToScan.add(obj.key);

    // If a limit is set and we've reached it, break out of the loop
    if (limit && filesToScan.size >= limit) {
      break;
    }
  }

  console.log(`Found ${filesToScan.size} objects to scan`);
  return filesToScan;
};

// Return readable stream for an object
export const getReadableStreamForObject = async (
  key: string,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null> => {
  const response = await (await getS3Client()).getObject(key);

  return response.body;
};
