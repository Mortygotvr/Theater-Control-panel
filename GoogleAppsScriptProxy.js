/**
 * Kick OAuth Token Proxy Web App
 * Securely performs OAuth code exchange and token refresh without exposing the Client Secret.
 * 
 * Instructions:
 * 1. Go to Google Drive, click New -> More -> Google Apps Script.
 * 2. Paste this code.
 * 3. Replace the placeholder values for `clientId` and `clientSecret` below with your Kick App's actual values.
 * 4. Click "Deploy" (top right) -> "New deployment".
 * 5. Choose "Web app" as the deployment type.
 * 6. Set Description: "Kick OAuth Proxy".
 * 7. Set Execute as: "Me (your-email@gmail.com)".
 * 8. Set Who has access: "Anyone".  <-- CRITICAL: MUST be set to "Anyone" for other users to use the API proxy.
 * 9. Click "Deploy". Authorize the permissions (click Advanced -> Go to Untitled Project if prompted).
 * 10. Copy the Web App URL generated and paste/configure it in your Control Panel Kick module.
 */

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    
    // Hardcoded Client Credentials inside your private Google Drive Script
    const clientId = "01KSMDKC9KR86WH1TBVNNSDCW4";
    const clientSecret = "cc094c4490584745cc391b2f80b42650e2731e2086c5c07674ecdd9caed25877";

    const tokenUrl = 'https://id.kick.com/oauth/token';
    const payload = {};

    if (action === 'exchange') {
      payload.grant_type = 'authorization_code';
      payload.code = postData.code;
      payload.redirect_uri = postData.redirect_uri;
      payload.code_verifier = postData.code_verifier;
      payload.client_id = clientId;
      payload.client_secret = clientSecret;
    } else if (action === 'refresh') {
      payload.grant_type = 'refresh_token';
      payload.refresh_token = postData.refresh_token;
      payload.client_id = clientId;
      payload.client_secret = clientSecret;
    } else {
      return buildResponse({ error: 'invalid_action', error_description: 'Action must be "exchange" or "refresh".' }, 400);
    }

    // Call Kick's token endpoint
    const response = UrlFetchApp.fetch(tokenUrl, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: payload,
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    
    return ContentService.createTextOutput(responseBody)
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return buildResponse({ error: 'server_error', error_description: err.message }, 500);
  }
}

function buildResponse(data, code) {
  return ContentService.createTextOutput(JSON.stringify(data))
                       .setMimeType(ContentService.MimeType.JSON);
}

// Allow CORS pre-flight pre-requests
function doOptions(e) {
  return ContentService.createTextOutput("")
                       .setMimeType(ContentService.MimeType.TEXT);
}
