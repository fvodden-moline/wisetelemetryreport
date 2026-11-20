// One-line, secret-free description of an error, for logs and for anything sent to the browser.
// Never log or send the error object itself: an Axios error carries the request, and the Visual
// Crossing request has its API key in the address.
function describeError(err) {
  if (!err) return 'unknown error';
  const status = err.response && err.response.status;
  const message = String(err.message || err)
    // belt and braces: mask anything that looks like a key or token in a query string
    .replace(/([?&](?:key|api_key|apikey|token|password)=)[^&\s]+/gi, '$1***');
  return status && !message.includes(String(status)) ? `HTTP ${status}: ${message}` : message;
}

function httpStatus(err) {
  return (err && err.response && err.response.status) || null;
}

module.exports = { describeError, httpStatus };
