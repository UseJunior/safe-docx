import { JWT, OAuth2Client, GoogleAuth } from 'google-auth-library';
import type { GoogleDocsCredentials } from './types.js';
import { REQUIRED_SCOPES } from './types.js';
import { GoogleApiClient } from './api-client.js';

/**
 * Resolve Google API credentials from environment or explicit config.
 * Returns a GoogleApiClient backed by google-auth-library + native fetch.
 *
 * For domain-wide delegation (impersonateUser), we use JWT
 * with the `subject` parameter — GoogleAuth's clientOptions.subject does
 * not reliably pass through to the underlying JWT client.
 */
export async function resolveCredentials(
  credentials?: GoogleDocsCredentials,
): Promise<GoogleApiClient> {
  let getAccessToken: () => Promise<string>;

  if (credentials?.type === 'oauth2' && credentials.accessToken) {
    const oauth2Client = new OAuth2Client(
      credentials.clientId,
      credentials.clientSecret,
    );
    oauth2Client.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
    });
    getAccessToken = async () => {
      const { token } = await oauth2Client.getAccessToken();
      return token ?? credentials.accessToken!;
    };
  } else {
    const keyFile = credentials?.serviceAccountKeyPath ?? process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyFile) {
      throw new Error(
        'AUTH_ERROR: No Google credentials provided. Set GOOGLE_SERVICE_ACCOUNT_KEY env var ' +
        'or pass credentials via google_credentials parameter.',
      );
    }
    const subject = credentials?.impersonateUser ?? process.env.GOOGLE_IMPERSONATE_USER;

    if (subject) {
      // Domain-wide delegation: must use JWT with subject
      const jwtClient = new JWT({
        keyFile,
        scopes: [...REQUIRED_SCOPES],
        subject,
      });
      getAccessToken = async () => {
        const { token } = await jwtClient.getAccessToken();
        if (!token) throw new Error('AUTH_ERROR: JWT getAccessToken() returned null');
        return token;
      };
    } else {
      const authClient = new GoogleAuth({
        keyFile,
        scopes: [...REQUIRED_SCOPES],
      });
      getAccessToken = async () => {
        const token = await authClient.getAccessToken();
        if (!token) throw new Error('AUTH_ERROR: GoogleAuth getAccessToken() returned null');
        return token;
      };
    }
  }

  return new GoogleApiClient(getAccessToken);
}
