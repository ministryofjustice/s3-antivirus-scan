import { assertEquals, assertRejects } from "@std/assert";
import { streamToClamAv } from "./clam.ts";

// Mock data for testing
const createTestStream = (content: string): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    }
  });
};

const createLargeTestStream = (size: number): ReadableStream<Uint8Array> => {
  const chunkSize = 1024; // 1KB chunks
  let bytesWritten = 0;
  
  return new ReadableStream({
    start(controller) {
      const writeChunk = () => {
        if (bytesWritten >= size) {
          controller.close();
          return;
        }
        
        const remainingBytes = size - bytesWritten;
        const currentChunkSize = Math.min(chunkSize, remainingBytes);
        const chunk = new Uint8Array(currentChunkSize).fill(65); // Fill with 'A' (ASCII 65)
        
        controller.enqueue(chunk);
        bytesWritten += currentChunkSize;
        
        // Schedule next chunk asynchronously
        setTimeout(writeChunk, 0);
      };
      
      writeChunk();
    }
  });
};

const createEicarTestStream = (): ReadableStream<Uint8Array> => {
  // EICAR test virus signature - standard test pattern for antivirus software
  const eicarSignature = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  return createTestStream(eicarSignature);
};

// Note: These tests require ClamAV to be running and accessible
// In Docker compose environment, ClamAV should be available at "clamav:3310"

Deno.test("streamToClamAv - clean file detection", async () => {
  const cleanStream = createTestStream("This is a clean test file content.");
  
  const result = await streamToClamAv(cleanStream);
  
  assertEquals(result.isInfected, false);
  assertEquals(result.virusName, undefined);
});

Deno.test("streamToClamAv - infected file detection", async () => {
  const infectedStream = createEicarTestStream();
  
  const result = await streamToClamAv(infectedStream);
  
  assertEquals(result.isInfected, true);
  assertEquals(typeof result.virusName, "string");
  // ClamAV typically returns "Eicar-Test-Signature" for EICAR test files
});

Deno.test("streamToClamAv - empty stream", async () => {
  const emptyStream = createTestStream("");
  
  const result = await streamToClamAv(emptyStream);
  
  assertEquals(result.isInfected, false);
  assertEquals(result.virusName, undefined);
});

Deno.test("streamToClamAv - large clean file", async () => {
  // Test with a 5MB file
  const largeStream = createLargeTestStream(5 * 1024 * 1024);
  
  const result = await streamToClamAv(largeStream);
  
  assertEquals(result.isInfected, false);
  assertEquals(result.virusName, undefined);
});

// Deno.test("streamToClamAv - handles connection errors", async () => {
//   // This test assumes ClamAV is not running or not accessible
//   // We'll need to temporarily modify the connection details to test error handling
  
//   const testStream = createTestStream("test content");

//   let errorCaught = false;
  
//   // This should reject if ClamAV is not accessible
//   // The actual behavior depends on whether ClamAV is running
//   try {
//     await streamToClamAv(testStream);
//   } catch (error) {
//     // Expected if ClamAV is not running
//     assertEquals(error instanceof Error, true);
//     errorCaught = true;
//   }

//   assertEquals(errorCaught, true, "Expected connection error was not caught");
// });

Deno.test("streamToClamAv - handles multiple chunks", async () => {
  // Create a stream that emits multiple chunks
  const multiChunkStream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const chunks = [
        "This is the first chunk. ",
        "This is the second chunk. ",
        "This is the third and final chunk."
      ];
      
      chunks.forEach(chunk => {
        controller.enqueue(encoder.encode(chunk));
      });
      
      controller.close();
    }
  });
  
  const result = await streamToClamAv(multiChunkStream);
  
  assertEquals(result.isInfected, false);
  assertEquals(result.virusName, undefined);
});

Deno.test({
  name: "streamToClamAv - handles stream read errors",
  fn: async () => {
    // Create a stream that errors during reading
    const errorStream = new ReadableStream({
      start(controller) {
        controller.error(new Error("Stream read error"));
      }
    });
    
    await assertRejects(
      () => streamToClamAv(errorStream),
      Error,
      "Stream read error"
    );
  },
  sanitizeResources: true,
  sanitizeOps: true,
});

// // Integration test that requires both S3 and ClamAV
// Deno.test("streamToClamAv - integration with S3 stream", async () => {
//   // This test would require setting up test data in S3 first
//   // For now, we'll skip this test unless in integration environment
  
//   const isIntegrationEnv = Deno.env.get("INTEGRATION_TESTS") === "true";
  
//   if (!isIntegrationEnv) {
//     console.log("Skipping integration test - set INTEGRATION_TESTS=true to run");
//     return;
//   }
  
//   // Import S3 functionality and test with actual S3 stream
//   const { getReadableStreamForObject } = await import("./s3.ts");
  
//   // Assume we have a test file in S3
//   const testKey = "test-clean-file.txt";
//   const s3Stream = await getReadableStreamForObject(testKey);
  
//   if (s3Stream) {
//     const result = await streamToClamAv(s3Stream);
//     assertEquals(result.isInfected, false);
//   }
// });

// Performance test for large files
Deno.test({
  name: "streamToClamAv - performance test with large file",
  fn: async () => {
    const startTime = performance.now();
    
    // Test with a 10MB file
    const largeStream = createLargeTestStream(10 * 1024 * 1024);
    
    const result = await streamToClamAv(largeStream);
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    console.log(`Large file scan took ${duration.toFixed(2)}ms`);
    
    assertEquals(result.isInfected, false);
    
    // Performance assertion - should complete within reasonable time
    // Adjust threshold based on your performance requirements
    const maxDurationMs = 30000; // 30 seconds
    if (duration > maxDurationMs) {
      console.warn(`Performance warning: Scan took ${duration.toFixed(2)}ms, expected < ${maxDurationMs}ms`);
    }
  },
  sanitizeResources: false, // Allow longer running test
  sanitizeOps: false,
});
