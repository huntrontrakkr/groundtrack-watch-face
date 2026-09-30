// Groundtrack Enroute, phone side. Fetches the current hour's scene and
// sends it to the watch in chunks, on launch, when the watch asks (a new
// hour, or a scene lost) and never on a timer of its own.
//
// Scenes come from a scene server (tools/scene-server.mjs in the repository)
// at the URL below; running the renderer on the phone itself is the next
// step. Settings are kept in localStorage.
var CHUNK = 2000;
var DEFAULT_SERVER = 'http://localhost:5199';

function setting(key, fallback) {
  var value = localStorage.getItem(key);
  return value === null ? fallback : value;
}

function fetchScene(done) {
  var url = setting('sceneServer', DEFAULT_SERVER) + '/scene?body=' + encodeURIComponent(setting('body', 'sun')) +
    '&plate=' + encodeURIComponent(setting('plate', 'enroute')) + '&flag=' + setting('flag', '1') +
    '&at=' + Date.now();
  var request = new XMLHttpRequest();
  request.open('GET', url);
  request.responseType = 'arraybuffer';
  request.onload = function () {
    if (request.status !== 200) { console.log('Scene server answered ' + request.status); return; }
    done(new Uint8Array(request.response));
  };
  request.onerror = function () { console.log('Scene server unreachable at ' + url); };
  request.send();
}

// One message at a time: the total, then each chunk with its offset.
function sendScene(bytes) {
  var offset = 0;
  function next() {
    if (offset >= bytes.length) { console.log('Scene sent: ' + bytes.length + ' bytes'); return; }
    var n = Math.min(CHUNK, bytes.length - offset), message = {SceneOffset: offset, SceneChunk: Array.prototype.slice.call(bytes.subarray(offset, offset + n))};
    Pebble.sendAppMessage(message, function () { offset += n; next(); }, function () { setTimeout(next, 500); });
  }
  Pebble.sendAppMessage({SceneTotal: bytes.length}, next, function () { console.log('The watch did not take the scene size'); });
}

function refresh() { fetchScene(sendScene); }

Pebble.addEventListener('ready', refresh);
Pebble.addEventListener('appmessage', function (e) { if (e.payload.SceneRequest !== undefined) refresh(); });
