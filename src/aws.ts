
export interface Credentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: Date;
}

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

    if(!Deno.env.get("AWS_ROLE_ARN")) {
        throw new Error("AWS_ROLE_ARN environment variable is not set");
    }

    // The file is ascii encoded
    let token: string;
    try {
        token = await Deno.readTextFile(tokenFilePath);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            throw new Deno.errors.NotFound(`AWS web identity token file not found: ${tokenFilePath}`);
        }
        console.log("Error reading token file:", error);
        throw error;
    }

    
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

    // Use regex to extract values
    const accessKeyIdMatch = responseText.match(/<AccessKeyId>([^<]+)<\/AccessKeyId>/);
    const secretAccessKeyMatch = responseText.match(/<SecretAccessKey>([^<]+)<\/SecretAccessKey>/);
    const sessionTokenMatch = responseText.match(/<SessionToken>([^<]+)<\/SessionToken>/);
    const expirationMatch = responseText.match(/<Expiration>([^<]+)<\/Expiration>/);

    const accessKeyId = accessKeyIdMatch ? accessKeyIdMatch[1] : null;
    const secretAccessKey = secretAccessKeyMatch ? secretAccessKeyMatch[1] : null;
    const sessionToken = sessionTokenMatch ? sessionTokenMatch[1] : null;
    const expiration = expirationMatch ? expirationMatch[1] : null;

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