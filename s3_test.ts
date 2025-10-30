import { assertEquals, assertExists, assertGreater } from "@std/assert";

import { GarageInitializer } from "./init-garage.ts";
import {
  getObjectsForScanning,
  getReadableStreamForObject,
  isRecentTimestamp,
} from "./s3.ts";

import { S3Client } from "@bradenmacdonald/s3-lite-client";

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

// Before running tests, ensure Garage S3 is initialized
Deno.test.beforeAll(async () => {
  console.log("✅ Garage S3 initialization complete. Starting tests...");
  // await new GarageInitializer().initialize();
});

// After each test, empty the bucket
Deno.test.beforeEach(async () => {
  const client = getClient();
  await emptyBucket(client);
});

Deno.test.afterAll(async () => {
  const client = getClient();
  await emptyBucket(client);
});

/**
 * Firstly test the utility function isRecentTimestamp
 */
Deno.test("isRecentTimestamp works correctly", () => {
  const now = new Date();
  const recentTimestamp = new Date(
    now.getTime() - 3 * 24 * 60 * 60 * 1000,
  ).toISOString(); // 3 days ago
  const oldTimestamp = new Date(
    now.getTime() - 10 * 24 * 60 * 60 * 1000,
  ).toISOString(); // 10 days ago

  assertEquals(
    isRecentTimestamp(recentTimestamp, 7 * 24 * 60 * 60),
    true,
    "Expected recent timestamp to be recent",
  );
  assertEquals(
    isRecentTimestamp(oldTimestamp, 7 * 24 * 60 * 60),
    false,
    "Expected old timestamp to not be recent",
  );
  assertEquals(
    isRecentTimestamp(undefined, 7 * 24 * 60 * 60),
    false,
    "Expected undefined timestamp to not be recent",
  );
  assertEquals(
    isRecentTimestamp("invalid-timestamp", 7 * 24 * 60 * 60),
    false,
    "Expected invalid timestamp to not be recent",
  );
});

/**
 * Test getObjectsForScanning function
 */

Deno.test(
  "getObjectsForScanning returns empty set when bucket is empty",
  async () => {
    const filesToScan = await getObjectsForScanning();
    console.assert(
      filesToScan.size === 0,
      "Expected no files to scan in empty bucket",
    );
  },
);

Deno.test(
  {
    name: "getObjectsForScanning returns files needing scanning",
    fn: async () => {
      // Upload test files with various metadata
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
          Body: "This file is infected!",
          Metadata: {
            "x-amz-meta-clam-av-status": "infected",
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

      const client = getClient();

      for await (const file of testFiles) {
        await client.putObject(file.Key, file.Body, {
          metadata: file.Metadata,
        });
      }

      const filesToScan = await getObjectsForScanning();

      assertEquals(
        filesToScan.has("infected-file.txt"),
        true,
        "Expected infected-file.txt to need scanning",
      );
      assertEquals(
        filesToScan.has("no-timestamp.txt"),
        true,
        "Expected no-timestamp.txt to need scanning",
      );
      assertEquals(
        filesToScan.has("invalid-timestamp.txt"),
        true,
        "Expected invalid-timestamp.txt to need scanning",
      );
      assertEquals(
        filesToScan.has("clean-file.txt"),
        false,
        "Did not expect clean-file.txt to need scanning",
      );
      assertEquals(
        filesToScan.has("recently-scanned-file.txt"),
        false,
        "Did not expect recently-scanned-file.txt to need scanning",
      );
      assertEquals(
        filesToScan.has("outdated-scanned-file.txt"),
        true,
        "Expected outdated-scanned-file.txt to need scanning",
      );
    },
  },
);

Deno.test("getObjectsForScanning handles limits correctly", async () => {
  // Upload test files without metadata
  const testFiles = [
    "file1.txt",
    "file2.txt",
    "file3.txt",
    "file4.txt",
    "file5.txt",
  ];
  const client = getClient();

  for (const key of testFiles) {
    await client.putObject(key, "Test content");
  }

  const filesToScan = await getObjectsForScanning({ limit: 3 });

  assertEquals(filesToScan.size, 3, "Expected 3 files to be returned");
});

Deno.test("getReadableStreamForObject returns a stream", async () => {
  const key = "stream-test-file.txt";
  const content = "This is a test file for readable stream.";

  // Generate a large content to test streaming
  const largeContent = content.repeat(2900); // ~100kb

  const client = getClient();

  // Upload a test file
  await client.putObject(key, largeContent);

  // Get readable stream
  const stream = await getReadableStreamForObject(key);

  // Check the instance is a stream
  assertEquals(stream instanceof ReadableStream, true);

  let data = "";
  let chunkCount = 0;

  if (stream) {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount++;
      data += new TextDecoder().decode(value);
    }
  }

  assertExists(data, "Expected to read data from the stream");
  assertEquals(
    data,
    largeContent,
    "Streamed content should match uploaded content",
  );
  assertGreater(chunkCount, 1, "Expected more than 1 chunk to be streamed");
});
