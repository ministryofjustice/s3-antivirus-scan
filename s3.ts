import { S3Client } from "@bradenmacdonald/s3-lite-client";

const s3Client = new S3Client({
  endPoint: "http://garage:3900",
  region: "garage",
  accessKey: "GK0123456789ABCDEF01234567",
  secretKey: "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
  bucket: "test-bucket",
  pathStyle: true,
});

// Constant so that we can define when the last recent scan must have been for skipping.
const LAST_SCAN_THRESHOLD_SECONDS = 7 * 24 * 60 * 60; // 1 week in seconds

/**
 * Checks if a timestamp is recent based on a threshold.
 *
 * @param timestamp - ISO timestamp string
 * @param thresholdSeconds - Time threshold in seconds
 * @returns true if the timestamp is within the threshold, false otherwise
 */
export const isRecentTimestamp = (
  timestamp: string | undefined,
  thresholdSeconds: number,
): boolean => {
  if (!timestamp || isNaN(Date.parse(timestamp))) {
    return false;
  }

  return Date.now() - new Date(timestamp).getTime() < thresholdSeconds * 1000;
};

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

    const objectStatus = await s3Client.statObject(obj.key);

    const clamAvStatus = objectStatus.metadata["x-amz-meta-clam-av-status"];
    const clamAvTimestamp = objectStatus.metadata["x-amz-meta-clam-av-timestamp"];

    const scannedRecently = isRecentTimestamp(
      clamAvTimestamp,
      LAST_SCAN_THRESHOLD_SECONDS,
    );

    // Does the value of clam_av_status indicate a clean scan?
    const isCleanScan = clamAvStatus === "clean";

    if (!scannedRecently || !isCleanScan) {
      filesToScan.add(obj.key);
    }

    // If a limit is set and we've reached it, break out of the loop
    if (limit && filesToScan.size >= limit) {
      break;
    }
  }

  return filesToScan;
};

// Return the checksum and readable stream for an object
export const getReadableStreamForObject = async (
  key: string,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null> => {
  const response = await s3Client.getObject(key);

  return response.body;
};
