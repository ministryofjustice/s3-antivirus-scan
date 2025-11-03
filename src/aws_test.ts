import { assertEquals, assertRejects } from "@std/assert";
import { webIdentityTokenProvider } from "./aws.ts";

// Mock STS server implementation
class MockSTSServer {
  private responses: Map<string, string> = new Map();
  private originalFetch: typeof fetch;

  constructor() {
    this.originalFetch = globalThis.fetch;
  }

  // Set up mock response for specific parameters
  setResponse(
    params: { action: string; roleArn: string; token: string },
    response: string,
  ) {
    const key = `${params.action}-${params.roleArn}-${params.token}`;
    this.responses.set(key, response);
  }

  // Mock the fetch function
  mock() {
    globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const urlObj = new URL(input instanceof Request ? input.url : input);

      // Check if this is a request to sts.amazonaws.com
      if (urlObj.hostname === "sts.amazonaws.com") {
        const action = urlObj.searchParams.get("Action");
        const roleArn = urlObj.searchParams.get("RoleArn");
        const token = urlObj.searchParams.get("WebIdentityToken");

        const key = `${action}-${roleArn}-${token}`;
        const mockResponse = this.responses.get(key);

        if (mockResponse) {
          return new Response(mockResponse, {
            status: 200,
            headers: { "Content-Type": "application/xml" },
          });
        } else {
          // Return error response if no mock is set up
          return new Response(
            `
                        <?xml version="1.0" encoding="UTF-8"?>
                        <ErrorResponse>
                            <Error>
                                <Code>InvalidRequest</Code>
                                <Message>Mock response not configured</Message>
                            </Error>
                        </ErrorResponse>
                    `,
            {
              status: 400,
              statusText: "Bad Request",
              headers: { "Content-Type": "application/xml" },
            },
          );
        }
      }

      // For any other URL, use the original fetch
      return this.originalFetch(input, init);
    };
  }

  // Restore original fetch
  restore() {
    globalThis.fetch = this.originalFetch;
  }
}

// Helper to create a temporary token file
async function createTempTokenFile(content: string): Promise<string> {
  // Ensure dir
  await Deno.mkdir("/tmp/deno", { recursive: true });
  const tempFile = await Deno.makeTempFile({
    dir: "/tmp/deno",
    suffix: ".token",
  });
  await Deno.writeTextFile(tempFile, content);
  return tempFile;
}

// Helper to clean up temporary files
async function cleanupTempFile(path: string) {
  try {
    await Deno.remove(path);
  } catch {
    // Ignore cleanup errors
  }
}

// Helper to create successful STS XML response
function createSuccessfulSTSResponse(
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  expiration: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
    <AssumeRoleWithWebIdentityResult>
        <Credentials>
            <AccessKeyId>${accessKeyId}</AccessKeyId>
            <SecretAccessKey>${secretAccessKey}</SecretAccessKey>
            <SessionToken>${sessionToken}</SessionToken>
            <Expiration>${expiration}</Expiration>
        </Credentials>
        <SubjectFromWebIdentityToken>system:serviceaccount:default:my-service-account</SubjectFromWebIdentityToken>
        <AssumedRoleUser>
            <AssumedRoleId>AROAEXAMPLE123:deno-web-identity-session</AssumedRoleId>
            <Arn>arn:aws:sts::123456789012:assumed-role/MyRole/deno-web-identity-session</Arn>
        </AssumedRoleUser>
    </AssumeRoleWithWebIdentityResult>
    <ResponseMetadata>
        <RequestId>b25f48e8-84fd-11e6-a7c8-example</RequestId>
    </ResponseMetadata>
</AssumeRoleWithWebIdentityResponse>`;
}

Deno.test("webIdentityTokenProvider - successful credential exchange", async () => {
  const mockServer = new MockSTSServer();
  const tokenContent = "test-jwt-token-content";
  const roleArn = "arn:aws:iam::123456789012:role/MyRole";

  let tokenFilePath: string | undefined;

  try {
    // Create temporary token file
    tokenFilePath = await createTempTokenFile(tokenContent);

    // Set up environment variables
    Deno.env.set("AWS_WEB_IDENTITY_TOKEN_FILE", tokenFilePath);
    Deno.env.set("AWS_ROLE_ARN", roleArn);

    // Set up mock response
    const expectedResponse = createSuccessfulSTSResponse(
      "AKIAIOSFODNN7EXAMPLE",
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLVXEi...",
      "2023-11-03T14:30:00Z",
    );

    mockServer.setResponse({
      action: "AssumeRoleWithWebIdentity",
      roleArn,
      token: tokenContent,
    }, expectedResponse);

    // Mock the fetch function
    mockServer.mock();

    // Call the function
    const credentials = await webIdentityTokenProvider();

    // Verify the returned credentials
    assertEquals(credentials.accessKeyId, "AKIAIOSFODNN7EXAMPLE");
    assertEquals(
      credentials.secretAccessKey,
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
    assertEquals(
      credentials.sessionToken,
      "AQoEXAMPLEH4aoAH0gNCAPyJxz4BlCFFxWNE1OPTgk5TthT+FvwqnKwRcOIfrRh3c/LTo6UDdyJwOOvEVPvLVXEi...",
    );
    assertEquals(credentials.expiration, new Date("2023-11-03T14:30:00Z"));
  } finally {
    // Cleanup
    mockServer.restore();
    if (tokenFilePath) {
      await cleanupTempFile(tokenFilePath);
    }
    Deno.env.delete("AWS_WEB_IDENTITY_TOKEN_FILE");
    Deno.env.delete("AWS_ROLE_ARN");
  }
});

Deno.test("webIdentityTokenProvider - missing token file environment variable", async () => {
  // Ensure the environment variable is not set
  Deno.env.delete("AWS_WEB_IDENTITY_TOKEN_FILE");

  await assertRejects(
    async () => {
      await webIdentityTokenProvider();
    },
    Error,
    "AWS_WEB_IDENTITY_TOKEN_FILE environment variable is not set",
  );
});

Deno.test("webIdentityTokenProvider - token file does not exist", async () => {
  // Set environment variable to a non-existent file
  Deno.env.set(
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "/tmp/deno/non-existent-token-file",
  );
  Deno.env.set("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/MyRole");

  try {
    await assertRejects(
      async () => {
        await webIdentityTokenProvider();
      },
      Deno.errors.NotFound,
    );
  } finally {
    Deno.env.delete("AWS_WEB_IDENTITY_TOKEN_FILE");
    Deno.env.delete("AWS_ROLE_ARN");
  }
});

Deno.test("webIdentityTokenProvider - STS returns error response", async () => {
  const mockServer = new MockSTSServer();
  const tokenContent = "invalid-jwt-token";
  const roleArn = "arn:aws:iam::123456789012:role/InvalidRole";

  let tokenFilePath: string | undefined;

  try {
    // Create temporary token file
    tokenFilePath = await createTempTokenFile(tokenContent);

    // Set up environment variables
    Deno.env.set("AWS_WEB_IDENTITY_TOKEN_FILE", tokenFilePath);
    Deno.env.set("AWS_ROLE_ARN", roleArn);

    // Mock the fetch function (no response set, so it will return error)
    mockServer.mock();

    await assertRejects(
      async () => {
        await webIdentityTokenProvider();
      },
      Error,
      "Failed to assume role with web identity: Bad Request",
    );
  } finally {
    // Cleanup
    mockServer.restore();
    if (tokenFilePath) {
      await cleanupTempFile(tokenFilePath);
    }
    Deno.env.delete("AWS_WEB_IDENTITY_TOKEN_FILE");
    Deno.env.delete("AWS_ROLE_ARN");
  }
});

Deno.test("webIdentityTokenProvider - malformed XML response", async () => {
  const mockServer = new MockSTSServer();
  const tokenContent = "test-jwt-token";
  const roleArn = "arn:aws:iam::123456789012:role/MyRole";

  let tokenFilePath: string | undefined;

  try {
    // Create temporary token file
    tokenFilePath = await createTempTokenFile(tokenContent);

    // Set up environment variables
    Deno.env.set("AWS_WEB_IDENTITY_TOKEN_FILE", tokenFilePath);
    Deno.env.set("AWS_ROLE_ARN", roleArn);

    // Set up malformed XML response
    const malformedResponse = `<?xml version="1.0" encoding="UTF-8"?>
<AssumeRoleWithWebIdentityResponse>
    <AssumeRoleWithWebIdentityResult>
        <Credentials>
            <!-- Missing required fields -->
        </Credentials>
    </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`;

    mockServer.setResponse({
      action: "AssumeRoleWithWebIdentity",
      roleArn,
      token: tokenContent,
    }, malformedResponse);

    // Mock the fetch function
    mockServer.mock();

    await assertRejects(
      async () => {
        await webIdentityTokenProvider();
      },
      Error,
      "Failed to parse AWS credentials from response",
    );
  } finally {
    // Cleanup
    mockServer.restore();
    if (tokenFilePath) {
      await cleanupTempFile(tokenFilePath);
    }
    Deno.env.delete("AWS_WEB_IDENTITY_TOKEN_FILE");
    Deno.env.delete("AWS_ROLE_ARN");
  }
});

Deno.test("webIdentityTokenProvider - missing role ARN environment variable", async () => {
  const mockServer = new MockSTSServer();
  const tokenContent = "test-jwt-token";

  let tokenFilePath: string | undefined;

  try {
    // Create temporary token file
    tokenFilePath = await createTempTokenFile(tokenContent);

    // Set up environment variables (missing AWS_ROLE_ARN)
    Deno.env.set("AWS_WEB_IDENTITY_TOKEN_FILE", tokenFilePath);
    Deno.env.delete("AWS_ROLE_ARN");

    // Since XML parsing is currently disabled, this will fail with parsing error
    await assertRejects(
      async () => {
        await webIdentityTokenProvider();
      },
      Error,
      "AWS_ROLE_ARN environment variable is not set",
    );
  } finally {
    // Cleanup
    mockServer.restore();
    if (tokenFilePath) {
      await cleanupTempFile(tokenFilePath);
    }
    Deno.env.delete("AWS_WEB_IDENTITY_TOKEN_FILE");
  }
});

Deno.test("webIdentityTokenProvider - validates request parameters", async () => {
  const tokenContent = "test-jwt-token";
  const roleArn = "arn:aws:iam::123456789012:role/MyRole";

  let tokenFilePath: string | undefined;
  let capturedUrl: URL | undefined;

  // Override fetch to capture the request
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedUrl = new URL(input instanceof Request ? input.url : input);
    return new Response(
      createSuccessfulSTSResponse(
        "AKIAIOSFODNN7EXAMPLE",
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "sessionToken",
        "2023-11-03T14:30:00Z",
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      },
    );
  };

  try {
    // Create temporary token file
    tokenFilePath = await createTempTokenFile(tokenContent);

    // Set up environment variables
    Deno.env.set("AWS_WEB_IDENTITY_TOKEN_FILE", tokenFilePath);
    Deno.env.set("AWS_ROLE_ARN", roleArn);

    // Call the function (it will fail due to disabled XML parsing, but we can still check the request)
    try {
      await webIdentityTokenProvider();
    } catch {
      // Ignore errors
    }

    // Verify the request parameters
    assertEquals(capturedUrl?.hostname, "sts.amazonaws.com");
    assertEquals(
      capturedUrl?.searchParams.get("Action"),
      "AssumeRoleWithWebIdentity",
    );
    assertEquals(capturedUrl?.searchParams.get("RoleArn"), roleArn);
    assertEquals(
      capturedUrl?.searchParams.get("RoleSessionName"),
      "deno-web-identity-session",
    );
    assertEquals(
      capturedUrl?.searchParams.get("WebIdentityToken"),
      tokenContent,
    );
    assertEquals(capturedUrl?.searchParams.get("Version"), "2011-06-15");
  } finally {
    // Cleanup
    globalThis.fetch = originalFetch;
    if (tokenFilePath) {
      await cleanupTempFile(tokenFilePath);
    }
    Deno.env.delete("AWS_WEB_IDENTITY_TOKEN_FILE");
    Deno.env.delete("AWS_ROLE_ARN");
  }
});
