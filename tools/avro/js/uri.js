function sharePage() {
  const uri_str = window.location.href;
  navigator.clipboard.writeText(uri_str);
  return uri_str;
}

function readParams(paraNames) {
  const params = new URLSearchParams(window.location.search);

  if (typeof paraNames === "string") {
    return decodeParam(params.get(paraNames));
  } else if (Array.isArray(paraNames)) {
    paraNames.map((name) => decodeParam(params.get(name)));
  }

  return null;
}

function setParam(key, val) {
  if (key === null || val === null) return;

  const params = new URLSearchParams(window.location.search);

  params.set(key, encodeParam(val));

  // Update the URL in the browser without reloading
  window.history.replaceState({}, "", `${location.pathname}?${params}`);
}

function decodeParam(param) {
  return param !== null ? decodeURI(param) : null;
}

function encodeParam(param) {
  return param !== null ? encodeURI(param) : null;
}
