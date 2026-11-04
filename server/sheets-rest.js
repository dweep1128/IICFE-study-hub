// The few Sheets v4 calls server/sheets.js makes, as plain REST requests through google-auth-library, in the same shape as
// googleapis' client (`spreadsheets.values.get(...)` resolving to `{ data }`). googleapis is ~240MB installed and took ~300ms to
// load on every cold start; this file replaces it. Errors are gaxios errors either way (status on err.response.status).
const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const enc = encodeURIComponent;
// Repeated keys (ranges=a&ranges=b), which batchGet needs; undefined values are left out.
const query = (params) => Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [v].flat().map((x) => `${k}=${enc(x)}`))).join("&");

function sheets({ auth }) {
  const call = (method, path, params = {}, data) => {
    const qs = query(params);
    return auth.request({ method, url: `${BASE}/${path}${qs ? `?${qs}` : ""}`, ...(data && { data }) });
  };
  return {
    spreadsheets: {
      get: ({ spreadsheetId, fields }) => call("GET", enc(spreadsheetId), { fields }),
      batchUpdate: ({ spreadsheetId, requestBody }) => call("POST", `${enc(spreadsheetId)}:batchUpdate`, {}, requestBody),
      values: {
        get: ({ spreadsheetId, range }) => call("GET", `${enc(spreadsheetId)}/values/${enc(range)}`),
        batchGet: ({ spreadsheetId, ranges }) => call("GET", `${enc(spreadsheetId)}/values:batchGet`, { ranges }),
        update: ({ spreadsheetId, range, valueInputOption, requestBody }) =>
          call("PUT", `${enc(spreadsheetId)}/values/${enc(range)}`, { valueInputOption }, requestBody),
        append: ({ spreadsheetId, range, valueInputOption, insertDataOption, requestBody }) =>
          call("POST", `${enc(spreadsheetId)}/values/${enc(range)}:append`, { valueInputOption, insertDataOption }, requestBody),
      },
    },
  };
}

module.exports = { sheets };
