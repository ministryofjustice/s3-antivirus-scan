import { assertEquals } from "@std/assert";
import { S3Client } from "@bradenmacdonald/s3-lite-client";
import { main } from "./main.ts";

const getClient = () => {
  return new S3Client({
    endPoint: "http://garage:3900",
    region: "garage",
    accessKey: "GK0123456789ABCDEF01234567",
    secretKey:
      "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
    bucket: "test-bucket",
    pathStyle: true,
  });
};

const emptyBucket = async (client: S3Client) => {
  // Wait 500ms to ensure previous operations are settled
  await new Promise((resolve) => setTimeout(resolve, 500));
  for await (const object of client.listObjects()) {
    if (object.key) {
      await client.deleteObject(object.key);
    }
  }
};

// After each test, empty the bucket
Deno.test.beforeAll(async () => {
  const client = getClient();
  await emptyBucket(client);

  const testFiles = [
    {
      Key: "clean-file.txt",
      Body: "This is a clean file.",
      Metadata: {
        "x-amz-meta-clam-av-status": "clean",
        "x-amz-meta-clam-av-timestamp": new Date().toISOString(),
      },
    },
    {
      Key: "recently-scanned-file.txt",
      Body: "This file was scanned recently.",
      Metadata: {
        "x-amz-meta-clam-av-status": "clean",
        "x-amz-meta-clam-av-timestamp": new Date(
          Date.now() - 6 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    },
    {
      Key: "outdated-scanned-file.txt",
      Body: "This file was scanned recently.",
      Metadata: {
        "x-amz-meta-clam-av-status": "clean",
        "x-amz-meta-clam-av-timestamp": new Date(
          Date.now() - 8 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    },
    {
      Key: "infected-file.txt",
      Body: 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      Metadata: {
        "x-amz-meta-clam-av-timestamp": new Date().toISOString(),
      },
    },
    {
      Key: "no-timestamp.txt",
      Body: "No timestamp here.",
      Metadata: { "x-amz-meta-clam-av-status": "clean" } as Record<
        string,
        string
      >,
    },
    {
      Key: "invalid-timestamp.txt",
      Body: "Invalid timestamp.",
      Metadata: {
        "x-amz-meta-clam-av-status": "clean",
        "x-amz-meta-clam-av-timestamp": "not-a-timestamp",
      },
    },
  ];

  for (const file of testFiles) {
    await client.putObject(file.Key, file.Body, {
      metadata: file.Metadata,
    });
  }
});

Deno.test.afterAll(async () => {
  const client = getClient();
  await emptyBucket(client);
});

Deno.test("main function runs without errors", async () => {
  const summary = await main();
//   assertEquals(summary, {
//     processed: 6,
//     cleaned: 4,
//     infected: 1,
//     errors: 1,
//   });
  // intentionally fail
  assertEquals(summary, {
    processed: 6,
    cleaned: 5,
    infected: 1,
    errors: 1,
  });
});
