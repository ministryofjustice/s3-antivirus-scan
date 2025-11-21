import {
  getObjectsForScanning,
  getObjectStatus,
  getReadableStreamForObject,
  type S3ObjectStatus,
} from "./s3.ts";
import { streamToClamAv } from "./clam.ts";

export const main = async () => {
  const startTime = Date.now();

  const summary = {
    counts: {
      success: 0,
      clean: 0,
      infected: 0,
      errors: 0,
    },
    results: [] as Array<{
      objectKey: string;
      clamAVResponse?: { isInfected: boolean; virusName?: string };
      error?: unknown;
      objectStatus?: S3ObjectStatus;
      durationSeconds?: number;
    }>,
    durationSeconds: 0,
  };

  // Configure max file size from environment variable (default 25MB)
  const maxFileSize = parseInt(
    Deno.env.get("CLAMAV_MAX_FILE_SIZE") || "26214400",
  ); // 25MB in bytes

  const { objectKeys, aggregates } = await getObjectsForScanning({
    maxFileSize,
  });

  console.log("Scanning starting:", aggregates);

  if (objectKeys.size === 0) {
    console.log(
      "No objects found to scan. The bucket may be empty or no objects match the scanning criteria.",
    );
    return summary;
  }

  console.log(`Starting scan of ${objectKeys.size} objects`);

  let objectStartTime = 0;

  // Now we have an array of files that need to be scanned.
  for (const objectKey of objectKeys) {
    objectStartTime = Date.now();

    const stream = await getReadableStreamForObject(objectKey);

    if (!stream) {
      console.log(`Could not get stream for object: ${objectKey}`);
      continue;
    }

    // Send the stream to ClamAV for scanning

    try {
      const clamAVResponse = await streamToClamAv(stream);

      summary.counts.success++;

      if (!clamAVResponse.isInfected) {
        summary.counts.clean++;
      }

      if (clamAVResponse.isInfected) {
        summary.counts.infected++;
        summary.results.push({
          objectKey,
          clamAVResponse,
        });
      }

      console.log(
        `Scanned object: ${objectKey}, Result: ${
          clamAVResponse.isInfected
            ? `Infected (${clamAVResponse.virusName})`
            : "Clean"
        }`,
      );
    } catch (error) {
      console.error(`Error scanning object ${objectKey}:`, error);
      summary.counts.errors++;
      summary.results.push({
        objectKey,
        error,
        objectStatus: await getObjectStatus(objectKey),
        durationSeconds: (Date.now() - objectStartTime) / 1000,
      });
    }
  }

  summary.durationSeconds = (Date.now() - startTime) / 1000;

  console.log("Scanning complete:", summary);

  return summary;
};

// If the file is called directly, then run the main function
if (import.meta.main) {
  main().catch(console.error);
}
