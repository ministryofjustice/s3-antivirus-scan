import { S3Client } from "@bradenmacdonald/s3-lite-client";

import {s3Config} from "./config.ts";


const s3Client = new S3Client(s3Config);


export const getObjectsForScanning = async ({
  limit,
}: { limit?: number } = {}): Promise<Set<string>> => {
  // Create an empty set to hold files needing scanning
  const filesToScan = new Set<string>();

  for await (const obj of s3Client.listObjects()) {
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
  const response = await s3Client.getObject(key);

  return response.body;
};
