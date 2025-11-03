// If we dont have the environment variables, we should throw an error
if (!Deno.env.get("S3_ENDPOINT") || !Deno.env.get("S3_REGION") || !Deno.env.get("S3_BUCKET")) {
  throw new Error("Missing required S3 environment variables");
}

export const s3Config = {
  endPoint: Deno.env.get("S3_ENDPOINT")!,
  region:  Deno.env.get("S3_REGION")!,
  bucket: Deno.env.get("S3_BUCKET")!,
  // If we are testing, then we need to use the test credentials
  ...(Deno.env.get("NODE_ENV") === "test" && {
    accessKey: Deno.env.get("S3_ACCESS_KEY_ID"),
    secretKey: Deno.env.get("S3_SECRET_ACCESS_KEY"),
    pathStyle: true,
  })
};