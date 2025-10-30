/**
 * Simple Garage initialization script using HTTP API
 * Handles cluster setup and creates a single bucket for testing
 */

interface GarageStatus {
  layoutVersion: number;
  nodes: Array<{
    id: string;
    addr?: string;
    isUp: boolean;
    draining: boolean;
    role?: {
      zone: string;
      capacity?: number;
      tags: string[];
    };
  }>;
}

interface LayoutRole {
  zone: string;
  capacity: number;
  tags: string[];
}

export class GarageInitializer {
  private adminUrl: string;
  private adminToken: string;

  constructor() {
    // Default to garage service name when in Docker, localhost otherwise
    const defaultUrl = Deno.env.get("S3_ENDPOINT") ? "http://garage:3903" : "http://localhost:3903";
    this.adminUrl = Deno.env.get("GARAGE_ADMIN_URL") || defaultUrl;
    this.adminToken = Deno.env.get("GARAGE_ADMIN_TOKEN") || "test-admin-token-not-for-production";
  }

  private async makeRequest(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.adminUrl}${path}`;
    const headers = {
      "Authorization": `Bearer ${this.adminToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    return fetch(url, {
      ...options,
      headers,
    });
  }

  private async waitForApi(): Promise<void> {
    console.log("⏳ Waiting for Garage admin API to be ready...");
    const maxAttempts = 30;
    const delay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.makeRequest("/v2/GetClusterStatus");
        if (response.ok) {
          console.log("✅ Garage admin API is ready!");
          return;
        }
      } catch (error) {
        // API not ready yet
      }

      console.log("  Still waiting for admin API...");
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    throw new Error("❌ Timeout waiting for Garage admin API");
  }

  private async getStatus(): Promise<GarageStatus> {
    const response = await this.makeRequest("/v2/GetClusterStatus");
    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  private async assignNodeToLayout(nodeId: string): Promise<void> {
    const roleChanges = [{
      id: nodeId,
      zone: "dc1",
      capacity: 1000000000, // 1GB in bytes
      tags: ["dev"]
    }];

    console.log("⚙️  Assigning node to cluster layout...");
    const response = await this.makeRequest("/v2/UpdateClusterLayout", {
      method: "POST",
      body: JSON.stringify({ roles: roleChanges }),
    });

    if (!response.ok) {
      throw new Error(`Failed to assign layout: ${response.status} ${response.statusText}`);
    }
  }

  private async applyLayout(version: number): Promise<void> {
    console.log("✅ Applying layout changes...");
    const response = await this.makeRequest("/v2/ApplyClusterLayout", {
      method: "POST",
      body: JSON.stringify({ version }),
    });

    if (!response.ok) {
      throw new Error(`Failed to apply layout: ${response.status} ${response.statusText}`);
    }
  }

  private async isNodeInitialized(nodeId: string, status: GarageStatus): Promise<boolean> {
    const node = status.nodes.find(n => n.id === nodeId);
    return !!(node && node.role && typeof node.role.capacity === 'number');
  }

  private async createAccessKey(): Promise<{ accessKeyId: string; secretAccessKey: string }> {
    console.log("🔑 Creating access key...");
    
    // Use ImportKey to create a key with specific credentials
    // Garage requires accessKeyId to start with "GK" + exactly 12 hex-encoded bytes (24 hex chars)
    // Garage requires secretAccessKey to be exactly 32 hex-encoded bytes (64 hex chars)
    const credentials = {
      accessKeyId: "GK0123456789ABCDEF01234567",
      secretAccessKey: "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"
    };
    
    const response = await this.makeRequest("/v2/ImportKey", {
      method: "POST",
      body: JSON.stringify({
        name: "test-key",
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create access key: ${response.status} ${response.statusText}`);
    }

    return credentials;
  }

  private async createBucket(bucketName: string): Promise<void> {
    console.log(`🪣 Creating bucket: ${bucketName}`);
    const response = await this.makeRequest("/v2/CreateBucket", {
      method: "POST",
      body: JSON.stringify({ globalAlias: bucketName }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create bucket: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  private async bucketExists(bucketName: string): Promise<boolean> {
    const response = await this.makeRequest(`/v2/GetBucketInfo?globalAlias=${encodeURIComponent(bucketName)}`);
    return response.ok;
  }

  private async keyExists(accessKeyId: string): Promise<boolean> {
    const response = await this.makeRequest(`/v2/GetKeyInfo?id=${encodeURIComponent(accessKeyId)}`);
    return response.ok;
  }

  private async grantBucketPermissions(accessKeyId: string, bucketId: string): Promise<void> {
    console.log("🔐 Granting bucket permissions to access key...");
    const response = await this.makeRequest("/v2/AllowBucketKey", {
      method: "POST",
      body: JSON.stringify({
        bucketId,
        accessKeyId,
        permissions: {
          read: true,
          write: true,
          owner: true
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to grant bucket permissions: ${response.status} ${response.statusText}`);
    }
  }

  public async initialize(): Promise<void> {
    console.log("🚀 Initializing Garage S3 cluster via HTTP API...");

    // Wait for API to be ready
    await this.waitForApi();

    // Get cluster status
    console.log("🔍 Checking cluster status...");
    const status = await this.getStatus();
    
    if (!status.nodes || status.nodes.length === 0) {
      throw new Error("No nodes found in cluster status");
    }
    
    // Find the current node (should be the first one in single-node setup)
    const currentNode = status.nodes[0];
    const nodeId = currentNode.id;
    
    console.log(`🆔 Node ID: ${nodeId.substring(0, 16)}...`);

    // Check if already initialized
    if (await this.isNodeInitialized(nodeId, status)) {
      console.log("✅ Garage cluster already initialized!");
    } else {
      console.log("🏗️  Node needs initialization...");
      
      // Assign node to layout
      await this.assignNodeToLayout(nodeId);
      
      // Get updated status for layout version
      const updatedStatus = await this.getStatus();
      
      // Apply layout
      await this.applyLayout(updatedStatus.layoutVersion);
      
      console.log("🎉 Garage cluster initialized successfully!");
    }

    // Create access key and bucket
    const bucketName = "test-bucket";
    const accessKeyId = "GK0123456789ABCDEF01234567";
    
    // Ensure access key exists
    if (await this.keyExists(accessKeyId)) {
      console.log(`✅ Access key '${accessKeyId}' already exists!`);
    } else {
      console.log("🔑 Creating access key...");
      await this.createAccessKey();
    }
    
    // Ensure bucket exists
    let bucketId: string;
    if (await this.bucketExists(bucketName)) {
      console.log(`✅ Bucket '${bucketName}' already exists!`);
      // Get bucket info to extract bucket ID
      const bucketResponse = await this.makeRequest(`/v2/GetBucketInfo?globalAlias=${encodeURIComponent(bucketName)}`);
      const bucketData = await bucketResponse.json();
      bucketId = bucketData.id;
    } else {
      console.log("🪣 Creating bucket...");
      await this.createBucket(bucketName);
      // Get the newly created bucket ID
      const bucketResponse = await this.makeRequest(`/v2/GetBucketInfo?globalAlias=${encodeURIComponent(bucketName)}`);
      const bucketData = await bucketResponse.json();
      bucketId = bucketData.id;
    }
    
    // Grant permissions to access key for this bucket
    try {
      await this.grantBucketPermissions(accessKeyId, bucketId);
    } catch (error) {
      console.log("Note: Bucket permissions may already be set");
    }

    // Show final status
    console.log("\n� Garage S3 setup complete!");
    console.log("\n🌐 S3 API endpoint:", this.adminUrl.replace("3903", "3900"));
    console.log("⚙️  Admin API endpoint:", this.adminUrl);
    console.log(`🪣 Test bucket: ${bucketName}`);
  }
}
