/**
 * X (Twitter) OAuth Token and API Proxy Web App
 * Securely performs OAuth code exchange, token refresh, and tweet posting.
 * 
 * Instructions:
 * 1. Go to Google Drive, click New -> More -> Google Apps Script.
 * 2. Paste this code.
 * 3. Replace the placeholder values or set client credentials as needed.
 * 4. Click "Deploy" (top right) -> "New deployment".
 * 5. Choose "Web app" as the deployment type.
 * 6. Set Description: "X OAuth Proxy".
 * 7. Set Execute as: "Me (your-email@gmail.com)".
 * 8. Set Who has access: "Anyone".  <-- CRITICAL: MUST be set to "Anyone" for other users to use the API proxy.
 * 9. Click "Deploy". Authorize the permissions (click Advanced -> Go to Untitled Project if prompted).
 * 10. Copy the Web App URL generated and configure it in your Control Panel.
 */

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    
    // Fetch credentials from script properties or fallback to client payload
    const scriptProperties = PropertiesService.getScriptProperties();
    const clientId = scriptProperties.getProperty('CLIENT_ID') || postData.client_id;
    const clientSecret = scriptProperties.getProperty('CLIENT_SECRET') || postData.client_secret;

    if (action === 'exchange') {
      const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
      const payload = {
        grant_type: 'authorization_code',
        code: postData.code,
        redirect_uri: postData.redirect_uri,
        code_verifier: postData.code_verifier
      };
      
      const headers = {};
      if (clientSecret) {
        headers['Authorization'] = 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret);
      } else {
        payload.client_id = clientId;
      }

      const response = UrlFetchApp.fetch(tokenUrl, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        headers: headers,
        payload: payload,
        muteHttpExceptions: true
      });

      return buildResponse(response.getContentText(), response.getResponseCode());
    }
    
    if (action === 'refresh') {
      const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
      const payload = {
        grant_type: 'refresh_token',
        refresh_token: postData.refresh_token
      };

      const headers = {};
      if (clientSecret) {
        headers['Authorization'] = 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret);
      } else {
        payload.client_id = clientId;
      }

      const response = UrlFetchApp.fetch(tokenUrl, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        headers: headers,
        payload: payload,
        muteHttpExceptions: true
      });

      return buildResponse(response.getContentText(), response.getResponseCode());
    }

    if (action === 'proxy') {
      // General purpose CORS proxy
      const headers = postData.headers || {};
      const response = UrlFetchApp.fetch(postData.url, {
        method: postData.method || 'GET',
        headers: headers,
        payload: postData.body || undefined,
        muteHttpExceptions: true
      });

      return buildResponse(response.getContentText(), response.getResponseCode());
    }

    return buildResponse(JSON.stringify({ error: 'invalid_action', error_description: 'Action must be "exchange", "refresh", or "proxy".' }), 400);

  } catch (err) {
    return buildResponse(JSON.stringify({ error: 'server_error', error_description: err.message }), 500);
  }
}

function buildResponse(bodyText, code) {
  return ContentService.createTextOutput(bodyText)
                       .setMimeType(ContentService.MimeType.JSON);
}

// Allow CORS pre-flight requests
function doOptions(e) {
  return ContentService.createTextOutput("")
                       .setMimeType(ContentService.MimeType.TEXT);
}
