import {webIdentityTokenProvider} from "./aws.ts";
import { getObjectsForScanning, getReadableStreamForObject } from "./s3.ts";
import { streamToClamAv } from "./clam.ts";

export const main = async () => {

  const credentials = await webIdentityTokenProvider();
  console.log("Retrieved AWS credentials:", credentials);

  const objectsToScan = await getObjectsForScanning();

  const responses = [];

  // Now we have an array of files that need to be scanned.
  for (const objectKey of objectsToScan) {
    const stream = await getReadableStreamForObject(objectKey);

    if (!stream) {
      console.log(`Could not get stream for object: ${objectKey}`);
      continue;
    }

    // Send the stream to ClamAV for scanning

    const clamAVResponse = await streamToClamAv(stream);

    responses.push({
      objectKey,
      clamAVResponse,
    });
  }

  console.log("Scanning complete:", responses);

  return responses;
};

// If the file is called directly, then run the main function
if (import.meta.main) {
  main().catch(console.error);
}