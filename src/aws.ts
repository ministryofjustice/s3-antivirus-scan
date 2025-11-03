
/**
 * Zero-dependency function to retrieve AWS credentials from the web identity token file.
 * 
 * @returns {Promise<Credentials>} The AWS credentials.
 */
export async function webIdentityTokenProvider(): Promise<Credentials> {
    const tokenFilePath = Deno.env.get("AWS_WEB_IDENTITY_TOKEN_FILE");
    if (!tokenFilePath) {
        throw new Error("AWS_WEB_IDENTITY_TOKEN_FILE environment variable is not set");
    }

    // The file is ascii encoded
    const token = await Deno.readTextFile(tokenFilePath);
    
    // We need to make a request to AWS to exchange the token for credentials
    const url = new URL("https://sts.amazonaws.com/");
    url.searchParams.append("Action", "AssumeRoleWithWebIdentity");
    url.searchParams.append("RoleArn", Deno.env.get("AWS_ROLE_ARN") || "");
    url.searchParams.append("RoleSessionName", "deno-web-identity-session");
    url.searchParams.append("WebIdentityToken", token);
    url.searchParams.append("Version", "2011-06-15");

    const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to assume role with web identity: ${response.statusText}`);
    }

    const responseText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(responseText, "application/xml");

    const accessKeyId = xmlDoc.getElementsByTagName("AccessKeyId")[0]?.textContent;
    const secretAccessKey = xmlDoc.getElementsByTagName("SecretAccessKey")[0]?.textContent;
    const sessionToken = xmlDoc.getElementsByTagName("SessionToken")[0]?.textContent;
    const expiration = xmlDoc.getElementsByTagName("Expiration")[0]?.textContent;

    if (!accessKeyId || !secretAccessKey || !sessionToken || !expiration) {
        throw new Error("Failed to parse AWS credentials from response");
    }

    return {
        accessKeyId,
        secretAccessKey,
        sessionToken,
        expiration: new Date(expiration)
    };
}