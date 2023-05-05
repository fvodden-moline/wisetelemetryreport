const axios = require('axios');

async function getAccessToken(tenantId, clientId, clientSecret) {
  const resource = 'https://graph.microsoft.com';
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', resource + '/.default');
  params.append('grant_type', 'client_credentials');

  const config = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  try {
    console.info('Obtaining access token...');
    const response = await axios.post(url, params, config);
    return response.data.access_token;
  } catch (error) {
    console.error(`Failed to obtain access token: ${error.message}`);
    return null;
  }
}

module.exports = getAccessToken;